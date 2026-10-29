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

// Contas individuais de funcionários: senhas armazenadas com scrypt e sessões assinadas.
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const COOKIE_NAME = 'rd_staff';
const SESSION_MS = 4 * 60 * 60 * 1000;
const loginTentativas = new Map();
const JANELA_LOGIN_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS_LOGIN = 8;
const EM_PRODUCAO = process.env.NODE_ENV === 'production';
setInterval(() => {
  const agora = Date.now();
  for (const [ip, tentativa] of loginTentativas) if (agora - tentativa.inicio > JANELA_LOGIN_MS) loginTentativas.delete(ip);
}, JANELA_LOGIN_MS).unref();

function assinar(valor) { return crypto.createHmac('sha256', SESSION_SECRET).update(valor).digest('hex'); }
function tokenValido(req) {
  if (!SESSION_SECRET || SESSION_SECRET.length < 32) return null;
  let cookies;
  try { cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(p => p.trim()).filter(Boolean).map(p => { const i=p.indexOf('='); return [p.slice(0,i), decodeURIComponent(p.slice(i+1)||'')]; })); }
  catch { return null; }
  const token = cookies[COOKIE_NAME]; if (!token) return null;
  const partes=token.split('.'); if(partes.length!==2) return null;
  const [payloadCodificado, assinatura]=partes; const esperada=assinar(payloadCodificado);
  const a=Buffer.from(assinatura), b=Buffer.from(esperada);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
  try { const dados=JSON.parse(Buffer.from(payloadCodificado,'base64url').toString()); return dados.exp> Date.now() && dados.id ? dados : null; }
  catch { return null; }
}
function exigirFuncionario(req,res,next) {
  const usuario=tokenValido(req);
  if(usuario){ req.funcionario=usuario; return next(); }
  if(req.path.startsWith('/api/')) return res.status(401).json({erro:'Acesso restrito aos funcionários. Faça login novamente.'});
  return res.redirect('/login-funcionarios');
}
function exigirGerente(req,res,next) {
  exigirFuncionario(req,res,()=> req.funcionario?.papel==='gerente' ? next() : erro(res,403,'Somente a gerência pode administrar contas de funcionários.'));
}
function hashSenha(senha, salt=crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve,reject)=>crypto.scrypt(senha,salt,64,(e,key)=>e?reject(e):resolve(`${salt}:${key.toString('hex')}`)));
}
async function senhaConfere(senha, armazenada) {
  if(!armazenada || !armazenada.includes(':')) return false;
  const [salt,hash]=armazenada.split(':');
  try { const atual=await hashSenha(senha,salt); const a=Buffer.from(atual.split(':')[1],'hex'), b=Buffer.from(hash,'hex'); return a.length===b.length && crypto.timingSafeEqual(a,b); } catch { return false; }
}
app.post('/api/funcionarios/login', async (req,res)=>{
  const agora=Date.now(), ip=String(req.ip||req.socket.remoteAddress||'desconhecido');
  let tentativa=loginTentativas.get(ip); if(!tentativa||agora-tentativa.inicio>JANELA_LOGIN_MS) tentativa={inicio:agora,quantidade:0};
  if(tentativa.quantidade>=MAX_TENTATIVAS_LOGIN){const espera=Math.ceil((JANELA_LOGIN_MS-(agora-tentativa.inicio))/60000);return res.status(429).json({erro:`Muitas tentativas. Aguarde aproximadamente ${Math.max(1,espera)} minuto(s).`});}
  const usuario=String(req.body.usuario||'').trim(), senha=String(req.body.senha||'');
  if(!SESSION_SECRET || SESSION_SECRET.startsWith('COLOQUE_') || SESSION_SECRET.length<32) return erro(res,503,'Configure SESSION_SECRET com pelo menos 32 caracteres no .env.');
  try {
    const [rows]=await pool.execute('SELECT id,nome,usuario,senha_hash,papel FROM funcionarios WHERE usuario=? AND ativo=1 LIMIT 1',[usuario]);
    const conta=rows[0];
    if(!conta || !(await senhaConfere(senha,conta.senha_hash))){tentativa.quantidade++;loginTentativas.set(ip,tentativa);return erro(res,401,'Usuário ou senha incorretos.');}
    loginTentativas.delete(ip);
    const dados={id:conta.id,nome:conta.nome,usuario:conta.usuario,papel:conta.papel,exp:Date.now()+SESSION_MS};
    const payload=Buffer.from(JSON.stringify(dados)).toString('base64url');
    const token=`${payload}.${assinar(payload)}`;
    res.setHeader('Set-Cookie',`${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS/1000)}${EM_PRODUCAO?'; Secure':''}`);
    await registrarAuditoria(pool, { ...req, funcionario: dados }, 'LOGIN', 'funcionario', conta.id, { usuario: conta.usuario });
    res.json({mensagem:'Login realizado.',redirecionar:'/painel-funcionarios',funcionario:{nome:conta.nome,papel:conta.papel}});
  } catch(e){console.error(e);erro(res,500,'Não foi possível realizar o login.');}
});
app.post('/api/funcionarios/logout',(_req,res)=>{res.setHeader('Set-Cookie',`${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${EM_PRODUCAO?'; Secure':''}`);res.json({mensagem:'Sessão encerrada.'});});
app.get('/api/funcionarios/eu',exigirFuncionario,(req,res)=>res.json({id:req.funcionario.id,nome:req.funcionario.nome,usuario:req.funcionario.usuario,papel:req.funcionario.papel}));
app.get('/api/funcionarios',exigirGerente,async(_req,res)=>{try{const [rows]=await pool.execute('SELECT id,nome,usuario,papel,ativo,criado_em FROM funcionarios ORDER BY nome');res.json(rows);}catch(e){console.error(e);erro(res,500,'Não foi possível listar os funcionários.');}});
app.post('/api/funcionarios',exigirGerente,async(req,res)=>{
  const nome=String(req.body.nome||'').trim(), usuario=String(req.body.usuario||'').trim(), senha=String(req.body.senha||''), papel=String(req.body.papel||'funcionario');
  if(nome.length<3||nome.length>100) return erro(res,400,'Informe o nome (3 a 100 caracteres).');
  if(!/^[a-zA-Z0-9._-]{4,30}$/.test(usuario)) return erro(res,400,'O usuário deve ter de 4 a 30 caracteres: letras, números, ponto, hífen ou underline.');
  if(senha.length<12||senha.length>128) return erro(res,400,'A senha deve ter entre 12 e 128 caracteres.');
  if(!['gerente','funcionario'].includes(papel)) return erro(res,400,'Papel inválido.');
  try{const hash=await hashSenha(senha);const [r]=await pool.execute('INSERT INTO funcionarios(nome,usuario,senha_hash,papel,ativo) VALUES(?,?,?,?,1)',[nome,usuario,hash,papel]);await registrarAuditoria(pool,req,'FUNCIONARIO_CADASTRADO','funcionario',r.insertId,{nome,usuario,papel});res.status(201).json({mensagem:'Funcionário cadastrado.',id:r.insertId});}
  catch(e){if(e.code==='ER_DUP_ENTRY')return erro(res,409,'Esse nome de usuário já está em uso.');console.error(e);erro(res,500,'Não foi possível cadastrar o funcionário.');}
});
app.patch('/api/funcionarios/:id/status',exigirGerente,async(req,res)=>{
  const id=Number(req.params.id), ativo=req.body.ativo;
  if(!Number.isSafeInteger(id)||id<1||typeof ativo!=='boolean')return erro(res,400,'Dados inválidos.');
  if(id===Number(req.funcionario.id)&&!ativo)return erro(res,400,'Você não pode desativar sua própria conta.');
  try{const [r]=await pool.execute('UPDATE funcionarios SET ativo=? WHERE id=?',[ativo?1:0,id]);if(!r.affectedRows)return erro(res,404,'Funcionário não encontrado.');await registrarAuditoria(pool,req,ativo?'FUNCIONARIO_ATIVADO':'FUNCIONARIO_DESATIVADO','funcionario',id,{ativo});res.json({mensagem:ativo?'Conta ativada.':'Conta desativada.'});}
  catch(e){console.error(e);erro(res,500,'Não foi possível alterar a conta.');}
});
async function prepararContaInicial(){
  await pool.execute(`CREATE TABLE IF NOT EXISTS funcionarios (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(100) NOT NULL,
    usuario VARCHAR(30) NOT NULL UNIQUE, senha_hash VARCHAR(200) NOT NULL,
    papel ENUM('gerente','funcionario') NOT NULL DEFAULT 'funcionario',
    ativo BOOLEAN NOT NULL DEFAULT TRUE, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.execute(`CREATE TABLE IF NOT EXISTS auditoria (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    funcionario_id BIGINT UNSIGNED NULL,
    funcionario_nome VARCHAR(100) NOT NULL,
    acao VARCHAR(60) NOT NULL,
    entidade VARCHAR(40) NOT NULL,
    entidade_id BIGINT UNSIGNED NULL,
    detalhes JSON NULL,
    ip VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL,
    criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auditoria_data (criada_em),
    INDEX idx_auditoria_funcionario (funcionario_id),
    CONSTRAINT fk_auditoria_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id) ON DELETE SET NULL
  )`);
  const [rows]=await pool.execute('SELECT COUNT(*) AS total FROM funcionarios');
  if(Number(rows[0].total)===0){
    const usuario=String(process.env.STAFF_USER||'').trim(), senha=String(process.env.STAFF_PASSWORD||'');
    if(!usuario||senha.length<12||senha.startsWith('DEFINA_')) throw new Error('Configure STAFF_USER e STAFF_PASSWORD (mínimo 12 caracteres) no .env para criar a primeira conta gerente.');
    const hash=await hashSenha(senha);
    await pool.execute("INSERT INTO funcionarios(nome,usuario,senha_hash,papel,ativo) VALUES(?,?,?,?,1)",[process.env.STAFF_NAME||'Gerência do Restaurante',usuario,hash,'gerente']);
    console.log(`Conta inicial de gerência criada para o usuário: ${usuario}`);
  }
}
app.get('/login-funcionarios', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login-funcionarios.html')));
app.get('/painel-funcionarios', exigirFuncionario, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'painel-funcionarios.html')));
app.get('/painel-funcionarios.html', exigirFuncionario, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'painel-funcionarios.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const { CAPACIDADE_DIARIA, MAX_POR_RESERVA, quantidadeValida, capacidadeDisponivel, cpfPodeReservar } = require('./lib/regras-negocio');
const { cpfSoDigitos, cpfValido, dataValida, formatarDataISO } = require('./lib/validacoes');

function hojeLocal() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}
function erro(res, status, mensagem) {
  return res.status(status).json({ erro: mensagem });
}

// Auditoria: registra ações administrativas e alterações importantes sem guardar senhas ou tokens.
async function registrarAuditoria(conn, req, acao, entidade, entidadeId, detalhes = {}) {
  const funcionario = req.funcionario || null;
  const ip = String(req.ip || req.socket?.remoteAddress || '').slice(0, 45) || null;
  const agente = String(req.headers['user-agent'] || '').slice(0, 255) || null;
  await conn.execute(
    `INSERT INTO auditoria (funcionario_id, funcionario_nome, acao, entidade, entidade_id, detalhes, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [funcionario?.id || null, funcionario?.nome || 'Cliente', acao, entidade, entidadeId || null,
      JSON.stringify(detalhes).slice(0, 4000), ip, agente]
  );
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
  if (!quantidadeValida(pessoas)) {
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
      if (!cpfPodeReservar(ativas.length)) {
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
    if (!capacidadeDisponivel(total, pessoas)) {
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
    await registrarAuditoria(conn, req, 'RESERVA_CRIADA', 'reserva', novaReserva.insertId, { cpfFinal: cpf.slice(-4), data, pessoas });

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
    await registrarAuditoria(conn, req, 'RESERVA_CANCELADA_EQUIPE', 'reserva', id, { cpfFinal: String(r.cpf).slice(-4), data: formatarDataISO(r.data_reserva), pessoas: Number(r.quantidade_pessoas) });
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

app.get('/api/auditoria', exigirGerente, async (req, res) => {
  const inicio = req.query.inicio ? String(req.query.inicio) : '';
  const fim = req.query.fim ? String(req.query.fim) : '';
  const busca = String(req.query.busca || '').trim();
  const acao = String(req.query.acao || '').trim();
  if (inicio && !dataValida(inicio)) return erro(res, 400, 'Data inicial inválida.');
  if (fim && !dataValida(fim)) return erro(res, 400, 'Data final inválida.');
  if (inicio && fim && inicio > fim) return erro(res, 400, 'A data inicial não pode ser posterior à final.');
  const where = [], params = [];
  if (inicio) { where.push('DATE(a.criada_em) >= ?'); params.push(inicio); }
  if (fim) { where.push('DATE(a.criada_em) <= ?'); params.push(fim); }
  if (busca) { where.push('(a.funcionario_nome LIKE ? OR a.entidade_id = ?)'); params.push(`%${busca}%`, /^\d+$/.test(busca) ? Number(busca) : -1); }
  if (acao) { where.push('a.acao = ?'); params.push(acao); }
  try {
    const [rows] = await pool.execute(
      `SELECT a.id, a.funcionario_id AS funcionarioId, a.funcionario_nome AS funcionario,
        a.acao, a.entidade, a.entidade_id AS entidadeId, a.detalhes,
        a.ip, DATE_FORMAT(a.criada_em, '%Y-%m-%d %H:%i:%s') AS criadaEm
       FROM auditoria a ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.criada_em DESC LIMIT 500`, params
    );
    res.json({ resultados: rows.map(r => ({ ...r, detalhes: typeof r.detalhes === 'string' ? JSON.parse(r.detalhes || '{}') : (r.detalhes || {}) })), limite: 500 });
  } catch (e) { console.error(e); erro(res, 500, 'Não foi possível consultar o registro de atividades.'); }
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
    await registrarAuditoria(conn, req, 'RESERVA_CANCELADA_CLIENTE', 'reserva', id, { cpfFinal: cpf.slice(-4) });
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
prepararContaInicial().then(()=>app.listen(port,()=>console.log(`Reino do Dragão API em http://localhost:${port}`))).catch(e=>{console.error('Falha na preparação das contas de funcionários:',e.message);process.exit(1);});
