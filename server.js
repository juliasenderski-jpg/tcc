require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const pool = require('./db');

const app = express();
app.use(express.json({ limit: '20kb' }));
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Autenticação simples para demonstração local. Configure usuário, senha e segredo no .env.
const STAFF_USER = process.env.STAFF_USER || 'funcionario';
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_NAME = 'rd_staff';
const SESSION_MS = 4 * 60 * 60 * 1000;
const loginTentativas = new Map();
const JANELA_LOGIN_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS_LOGIN = 8;
setInterval(() => {
  const agora = Date.now();
  for (const [ip, tentativa] of loginTentativas) {
    if (agora - tentativa.inicio > JANELA_LOGIN_MS) loginTentativas.delete(ip);
  }
}, JANELA_LOGIN_MS).unref();
const EM_PRODUCAO = process.env.NODE_ENV === 'production';

function assinar(valor) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(valor).digest('hex');
}
function tokenValido(req) {
  if (!SESSION_SECRET || !STAFF_PASSWORD) return false;
  let cookies;
  try {
    cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(p => p.trim()).filter(Boolean).map(p => {
      const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1) || '')];
    }));
  } catch { return false; }
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  const partes = token.split('.');
  if (partes.length !== 3) return false;
  const [usuarioCodificado, expiracao, assinatura] = partes;
  const payload = `${usuarioCodificado}.${expiracao}`;
  const esperada = assinar(payload);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    return decodeURIComponent(Buffer.from(usuarioCodificado, 'base64url').toString()) === STAFF_USER && Number(expiracao) > Date.now();
  } catch { return false; }
}
function exigirFuncionario(req, res, next) {
  if (tokenValido(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ erro: 'Acesso restrito aos funcionários. Faça login novamente.' });
  return res.redirect('/login-funcionarios');
}
app.post('/api/funcionarios/login', (req, res) => {
  const agora = Date.now();
  const ip = String(req.ip || req.socket.remoteAddress || 'desconhecido');
  let tentativa = loginTentativas.get(ip);
  if (!tentativa || agora - tentativa.inicio > JANELA_LOGIN_MS) tentativa = { inicio: agora, quantidade: 0 };
  if (tentativa.quantidade >= MAX_TENTATIVAS_LOGIN) {
    const espera = Math.ceil((JANELA_LOGIN_MS - (agora - tentativa.inicio)) / 60000);
    return res.status(429).json({ erro: `Muitas tentativas. Aguarde aproximadamente ${Math.max(1, espera)} minuto(s).` });
  }
  const usuario = String(req.body.usuario || '');
  const senha = String(req.body.senha || '');
  if (!STAFF_PASSWORD || !SESSION_SECRET || STAFF_PASSWORD.startsWith('DEFINA_') || STAFF_PASSWORD === 'TroqueEstaSenha123!' || SESSION_SECRET.startsWith('COLOQUE_') || SESSION_SECRET.length < 32) return res.status(503).json({ erro: 'Configure uma senha própria e um SESSION_SECRET com pelo menos 32 caracteres no arquivo .env.' });
  const u = Buffer.from(usuario); const eu = Buffer.from(STAFF_USER);
  const s = Buffer.from(senha); const es = Buffer.from(STAFF_PASSWORD);
  const usuarioOk = u.length === eu.length && crypto.timingSafeEqual(u, eu);
  const senhaOk = s.length === es.length && crypto.timingSafeEqual(s, es);
  if (!usuarioOk || !senhaOk) {
    tentativa.quantidade += 1;
    loginTentativas.set(ip, tentativa);
    return res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
  }
  loginTentativas.delete(ip);
  const expiracao = String(Date.now() + SESSION_MS);
  const usuarioCodificado = Buffer.from(STAFF_USER).toString('base64url');
  const payload = `${usuarioCodificado}.${expiracao}`;
  const token = `${payload}.${assinar(payload)}`;
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}${EM_PRODUCAO ? '; Secure' : ''}`);
  res.json({ mensagem: 'Login realizado.', redirecionar: '/painel-funcionarios' });
});
app.post('/api/funcionarios/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${EM_PRODUCAO ? '; Secure' : ''}`);
  res.json({ mensagem: 'Sessão encerrada.' });
});
app.get('/login-funcionarios', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login-funcionarios.html')));
app.get('/painel-funcionarios', exigirFuncionario, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'painel-funcionarios.html')));
app.get('/painel-funcionarios.html', exigirFuncionario, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'painel-funcionarios.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const CAPACIDADE_DIARIA = 48;
const MAX_POR_RESERVA = 30;

const { cpfSoDigitos, cpfValido, dataValida, formatarDataISO } = require('./lib/validacoes');

function hojeLocal() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}
function erro(res, status, mensagem) {
  return res.status(status).json({ erro: mensagem });
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', banco: 'conectado' });
  } catch {
    erro(res, 503, 'API iniciada, mas não foi possível conectar ao banco de dados.');
  }
});

app.post('/api/reservas', async (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const cpf = cpfSoDigitos(req.body.cpf);
  const telefone = String(req.body.telefone || '').trim();
  const data = String(req.body.data || '');
  const pessoas = Number(req.body.pessoas);

  if (nome.length < 3 || nome.length > 120) return erro(res, 400, 'Informe o nome completo (3 a 120 caracteres).');
  if (!cpfValido(cpf)) return erro(res, 400, 'Informe um CPF válido.');
  if (telefone.length < 8 || telefone.length > 20) return erro(res, 400, 'Informe um telefone válido.');
  if (!dataValida(data) || data < hojeLocal()) return erro(res, 400, 'Escolha uma data válida de hoje em diante.');
  if (!Number.isInteger(pessoas) || pessoas < 1 || pessoas > MAX_POR_RESERVA) {
    return erro(res, 400, 'A reserva deve ter entre 1 e 30 pessoas.');
  }

  const conn = await pool.getConnection();
  const locks = [];
  try {
    // Locks nomeados impedem duas criações simultâneas para o mesmo CPF ou data.
    for (const chave of [`reino_cpf_${cpf}`, `reino_data_${data}`]) {
      const [resultadoLock] = await conn.query('SELECT GET_LOCK(?, 5) AS adquirido', [chave]);
      if (Number(resultadoLock[0].adquirido) !== 1) {
        return erro(res, 503, 'O sistema está processando outra reserva. Tente novamente em alguns segundos.');
      }
      locks.push(chave);
    }
    await conn.beginTransaction();

    const [clienteExistente] = await conn.execute(
      'SELECT id FROM clientes WHERE cpf = ? FOR UPDATE', [cpf]
    );
    let clienteId;
    if (clienteExistente.length) {
      clienteId = clienteExistente[0].id;
      const [ativas] = await conn.execute(
        "SELECT id FROM reservas WHERE cliente_id = ? AND status = 'Confirmada' FOR UPDATE",
        [clienteId]
      );
      if (ativas.length) {
        await conn.rollback();
        return erro(res, 409, 'Este CPF já possui uma reserva ativa. Consulte ou cancele a reserva existente antes de fazer outra.');
      }
      await conn.execute('UPDATE clientes SET nome = ?, telefone = ? WHERE id = ?', [nome, telefone, clienteId]);
    } else {
      const [novoCliente] = await conn.execute(
        'INSERT INTO clientes (nome, cpf, telefone) VALUES (?, ?, ?)', [nome, cpf, telefone]
      );
      clienteId = novoCliente.insertId;
    }

    const [soma] = await conn.execute(
      "SELECT COALESCE(SUM(quantidade_pessoas), 0) AS total FROM reservas WHERE data_reserva = ? AND status = 'Confirmada' FOR UPDATE",
      [data]
    );
    const total = Number(soma[0].total);
    if (total + pessoas > CAPACIDADE_DIARIA) {
      await conn.rollback();
      return erro(res, 409, `Capacidade insuficiente para essa data. Já há ${total} pessoa(s) reservadas; o limite é ${CAPACIDADE_DIARIA}.`);
    }

    const [novaReserva] = await conn.execute(
      "INSERT INTO reservas (cliente_id, data_reserva, quantidade_pessoas, status) VALUES (?, ?, ?, 'Confirmada')",
      [clienteId, data, pessoas]
    );
    await conn.execute(
      'INSERT INTO notificacoes (reserva_id, cpf_cliente, tipo, mensagem) VALUES (?, ?, ?, ?)',
      [novaReserva.insertId, cpf, 'RESERVA', `Reserva confirmada para ${nome}, em ${data.split('-').reverse().join('/')} (${pessoas} pessoa(s)).`]
    );

    await conn.commit();
    res.status(201).json({
      mensagem: 'Reserva confirmada.',
      reserva: { id: novaReserva.insertId, nome, cpf, telefone, data, pessoas, status: 'Confirmada' }
    });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error(e);
    erro(res, 500, 'Não foi possível registrar a reserva.');
  } finally {
    for (const chave of locks.reverse()) {
      try { await conn.query('SELECT RELEASE_LOCK(?)', [chave]); } catch {}
    }
    conn.release();
  }
});

app.get('/api/reservas', exigirFuncionario, async (req, res) => {
  const { data, busca } = req.query;
  const filtros = ["r.status = 'Confirmada'"];
  const params = [];
  if (data) {
    if (!dataValida(data)) return erro(res, 400, 'Filtro de data inválido.');
    filtros.push('r.data_reserva = ?'); params.push(data);
  }
  if (busca) {
    const termo = String(busca).trim();
    const cpf = cpfSoDigitos(termo);
    filtros.push('(c.nome LIKE ? OR c.cpf LIKE ?)');
    params.push(`%${termo}%`, `%${cpf || termo}%`);
  }
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, c.nome, c.cpf, c.telefone, r.data_reserva AS data,
              r.quantidade_pessoas AS pessoas, r.status, r.criada_em AS criadaEm
       FROM reservas r JOIN clientes c ON c.id = r.cliente_id
       WHERE ${filtros.join(' AND ')}
       ORDER BY r.data_reserva, r.criada_em`,
      params
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    erro(res, 500, 'Não foi possível consultar as reservas.');
  }
});

app.post('/api/funcionarios/reservas/:id/cancelar', exigirFuncionario, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return erro(res, 400, 'Identificador de reserva inválido.');
  const conn = await pool.getConnection();
  let lockData = null;
  try {
    const [dados] = await conn.execute(
      "SELECT DATE_FORMAT(data_reserva, '%Y-%m-%d') AS data_reserva FROM reservas WHERE id = ? AND status = 'Confirmada'",
      [id]
    );
    if (!dados.length) return erro(res, 404, 'Reserva ativa não encontrada. Ela pode já ter sido cancelada.');
    lockData = `reino_data_${String(dados[0].data_reserva).slice(0, 10)}`;
    const [resultadoLock] = await conn.query('SELECT GET_LOCK(?, 5) AS adquirido', [lockData]);
    if (Number(resultadoLock[0].adquirido) !== 1) {
      lockData = null;
      return erro(res, 503, 'Não foi possível bloquear a data agora. Tente novamente.');
    }
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT r.id, r.data_reserva, r.quantidade_pessoas, c.cpf, c.nome
       FROM reservas r JOIN clientes c ON c.id = r.cliente_id
       WHERE r.id = ? AND r.status = 'Confirmada' FOR UPDATE`, [id]
    );
    if (!rows.length) {
      await conn.rollback();
      return erro(res, 404, 'A reserva já não está ativa. Atualize a lista.');
    }
    const r = rows[0];
    await conn.execute(
      "UPDATE reservas SET status = 'Cancelada', cancelada_em = CURRENT_TIMESTAMP WHERE id = ?", [id]
    );
    await conn.execute(
      'INSERT INTO notificacoes (reserva_id, cpf_cliente, tipo, mensagem) VALUES (?, ?, ?, ?)',
      [id, r.cpf, 'CANCELAMENTO', `A reserva de ${r.nome} para ${formatarDataISO(r.data_reserva)} foi cancelada pela equipe. A capacidade foi liberada.`]
    );
    await conn.commit();
    res.json({ mensagem: 'Reserva cancelada pela equipe. A capacidade foi liberada.' });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error(e);
    erro(res, 500, 'Não foi possível cancelar a reserva.');
  } finally {
    if (lockData) { try { await conn.query('SELECT RELEASE_LOCK(?)', [lockData]); } catch {} }
    conn.release();
  }
});

app.get('/api/relatorios/resumo', exigirFuncionario, async (req, res) => {
  const hoje = hojeLocal();
  const inicio = String(req.query.inicio || hoje);
  const fim = String(req.query.fim || inicio);
  if (!dataValida(inicio) || !dataValida(fim) || inicio > fim) {
    return erro(res, 400, 'Informe um intervalo de datas válido. A data inicial não pode ser posterior à final.');
  }
  try {
    const [resumoRows] = await pool.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'Confirmada' THEN 1 ELSE 0 END), 0) AS reservas_confirmadas,
         COALESCE(SUM(CASE WHEN status = 'Confirmada' THEN quantidade_pessoas ELSE 0 END), 0) AS pessoas_confirmadas,
         COALESCE(SUM(CASE WHEN status = 'Cancelada' THEN 1 ELSE 0 END), 0) AS reservas_canceladas
       FROM reservas WHERE data_reserva BETWEEN ? AND ?`,
      [inicio, fim]
    );
    const [dias] = await pool.execute(
      `SELECT DATE_FORMAT(data_reserva, '%Y-%m-%d') AS data,
         SUM(CASE WHEN status = 'Confirmada' THEN 1 ELSE 0 END) AS reservas_confirmadas,
         SUM(CASE WHEN status = 'Confirmada' THEN quantidade_pessoas ELSE 0 END) AS pessoas_confirmadas,
         SUM(CASE WHEN status = 'Cancelada' THEN 1 ELSE 0 END) AS reservas_canceladas
       FROM reservas WHERE data_reserva BETWEEN ? AND ?
       GROUP BY data_reserva ORDER BY data_reserva`,
      [inicio, fim]
    );
    const resumo = resumoRows[0];
    res.json({
      intervalo: { inicio, fim },
      totais: {
        reservasConfirmadas: Number(resumo.reservas_confirmadas || 0),
        pessoasConfirmadas: Number(resumo.pessoas_confirmadas || 0),
        reservasCanceladas: Number(resumo.reservas_canceladas || 0)
      },
      capacidadeDiaria: CAPACIDADE_DIARIA,
      dias: dias.map(d => ({
        data: d.data,
        reservasConfirmadas: Number(d.reservas_confirmadas || 0),
        pessoasConfirmadas: Number(d.pessoas_confirmadas || 0),
        reservasCanceladas: Number(d.reservas_canceladas || 0),
        vagasRestantes: Math.max(0, CAPACIDADE_DIARIA - Number(d.pessoas_confirmadas || 0))
      }))
    });
  } catch (e) {
    console.error(e);
    erro(res, 500, 'Não foi possível gerar o relatório de reservas.');
  }
});

app.get('/api/historico-reservas', exigirFuncionario, async (req, res) => {
  const cpfBusca = req.query.cpf ? cpfSoDigitos(req.query.cpf) : '';
  const busca = String(req.query.busca || '').trim();
  const inicio = req.query.inicio ? String(req.query.inicio) : '';
  const fim = req.query.fim ? String(req.query.fim) : '';
  const status = String(req.query.status || 'Todos');
  if (req.query.cpf && !/^\d{11}$/.test(cpfBusca)) return erro(res, 400, 'Informe um CPF com 11 números.');
  if (inicio && !dataValida(inicio)) return erro(res, 400, 'Data inicial inválida.');
  if (fim && !dataValida(fim)) return erro(res, 400, 'Data final inválida.');
  if (inicio && fim && inicio > fim) return erro(res, 400, 'A data inicial não pode ser posterior à data final.');
  if (!['Todos', 'Confirmada', 'Cancelada'].includes(status)) return erro(res, 400, 'Filtro de status inválido.');
  const where = [];
  const params = [];
  if (cpfBusca) { where.push('c.cpf = ?'); params.push(cpfBusca); }
  if (busca) {
    const cpfNumerico = cpfSoDigitos(busca);
    where.push('(c.nome LIKE ? OR c.cpf LIKE ?)');
    params.push(`%${busca}%`, `%${cpfNumerico || busca}%`);
  }
  if (inicio) { where.push('r.data_reserva >= ?'); params.push(inicio); }
  if (fim) { where.push('r.data_reserva <= ?'); params.push(fim); }
  if (status !== 'Todos') { where.push('r.status = ?'); params.push(status); }
  try {
    const sql = `SELECT r.id, c.nome, c.cpf, c.telefone,
        DATE_FORMAT(r.data_reserva, '%Y-%m-%d') AS data,
        r.quantidade_pessoas AS pessoas, r.status,
        DATE_FORMAT(r.criada_em, '%Y-%m-%d %H:%i:%s') AS criadaEm,
        DATE_FORMAT(r.cancelada_em, '%Y-%m-%d %H:%i:%s') AS canceladaEm
      FROM reservas r JOIN clientes c ON c.id = r.cliente_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.data_reserva DESC, r.criada_em DESC LIMIT 500`;
    const [rows] = await pool.execute(sql, params);
    res.json({ resultados: rows, limite: 500 });
  } catch (e) {
    console.error(e);
    erro(res, 500, 'Não foi possível consultar o histórico de reservas.');
  }
});

app.get('/api/reservas/cliente/:cpf', async (req, res) => {
  const cpf = cpfSoDigitos(req.params.cpf);
  if (!/^\d{11}$/.test(cpf)) return erro(res, 400, 'CPF inválido.');
  try {
    const [rows] = await pool.execute(
      `SELECT r.id, c.nome, c.cpf, c.telefone, r.data_reserva AS data,
              r.quantidade_pessoas AS pessoas, r.status, r.criada_em AS criadaEm
       FROM reservas r JOIN clientes c ON c.id = r.cliente_id
       WHERE c.cpf = ? AND r.status = 'Confirmada'
       ORDER BY r.data_reserva`,
      [cpf]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    erro(res, 500, 'Não foi possível consultar a reserva.');
  }
});

app.delete('/api/reservas/:id', async (req, res) => {
  const id = Number(req.params.id);
  const cpf = cpfSoDigitos(req.body.cpf);
  if (!Number.isSafeInteger(id) || id < 1) return erro(res, 400, 'Identificador de reserva inválido.');
  if (!/^\d{11}$/.test(cpf)) return erro(res, 400, 'Informe o CPF usado na reserva.');

  const conn = await pool.getConnection();
  let lockData = null;
  try {
    const [dadosReserva] = await conn.execute("SELECT DATE_FORMAT(data_reserva, '%Y-%m-%d') AS data_reserva FROM reservas WHERE id = ?", [id]);
    if (dadosReserva.length) {
      lockData = `reino_data_${String(dadosReserva[0].data_reserva).slice(0, 10)}`;
      const [resultadoLock] = await conn.query('SELECT GET_LOCK(?, 5) AS adquirido', [lockData]);
      if (Number(resultadoLock[0].adquirido) !== 1) return erro(res, 503, 'Não foi possível bloquear a data agora. Tente novamente.');
    }
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      `SELECT r.id, r.data_reserva, c.id AS cliente_id, c.cpf, c.nome
       FROM reservas r JOIN clientes c ON c.id = r.cliente_id
       WHERE r.id = ? AND c.cpf = ? AND r.status = 'Confirmada' FOR UPDATE`,
      [id, cpf]
    );
    if (!rows.length) {
      await conn.rollback();
      return erro(res, 404, 'Reserva ativa não encontrada para esse CPF.');
    }
    const r = rows[0];
    await conn.execute(
      "UPDATE reservas SET status = 'Cancelada', cancelada_em = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );
    await conn.execute(
      'INSERT INTO notificacoes (reserva_id, cpf_cliente, tipo, mensagem) VALUES (?, ?, ?, ?)',
      [id, cpf, 'CANCELAMENTO', `A reserva de ${r.nome} para ${formatarDataISO(r.data_reserva)} foi cancelada. A capacidade foi liberada.`]
    );
    await conn.commit();
    res.json({ mensagem: 'Reserva cancelada. A capacidade foi liberada.' });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error(e);
    erro(res, 500, 'Não foi possível cancelar a reserva.');
  } finally {
    if (lockData) { try { await conn.query('SELECT RELEASE_LOCK(?)', [lockData]); } catch {} }
    conn.release();
  }
});

app.get('/api/notificacoes', (req, res, next) => req.query.cpf ? next() : exigirFuncionario(req, res, next), async (req, res) => {
  const cpf = req.query.cpf ? cpfSoDigitos(req.query.cpf) : null;
  if (req.query.cpf && !cpfValido(cpf)) return erro(res, 400, 'CPF inválido.');
  try {
    const sql = `SELECT id, cpf_cliente AS cpf, tipo, mensagem, criada_em AS data
                 FROM notificacoes ${cpf ? 'WHERE cpf_cliente = ?' : ''}
                 ORDER BY criada_em DESC LIMIT 200`;
    const [rows] = cpf ? await pool.execute(sql, [cpf]) : await pool.execute(sql);
    res.json(rows);
  } catch (e) {
    console.error(e);
    erro(res, 500, 'Não foi possível consultar as notificações.');
  }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Reino do Dragão API em http://localhost:${port}`));
