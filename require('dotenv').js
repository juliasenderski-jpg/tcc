require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const pool = require('./db');

const app = express();
app.use(cors()); // Para produção, restrinja aos domínios autorizados.
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/painel-funcionarios', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'painel-funcionarios.html')));

const CAPACIDADE_DIARIA = 48;
const MAX_POR_RESERVA = 30;

function cpfSoDigitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}
function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(cpf[i]) * (10 - i);
  let digito = (soma * 10) % 11;
  if (digito === 10) digito = 0;
  if (digito !== Number(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(cpf[i]) * (11 - i);
  digito = (soma * 10) % 11;
  if (digito === 10) digito = 0;
  return digito === Number(cpf[10]);
}
function dataValida(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) return false;
  const [a, m, d] = data.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
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
  try {
    await conn.beginTransaction();

    // Bloqueio transacional por data para reduzir o risco de ultrapassar a capacidade.
    await conn.query('SELECT GET_LOCK(?, 5)', [`reino_dragao_${data}`]);

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
    try { await conn.query('SELECT RELEASE_LOCK(?)', [`reino_dragao_${data}`]); } catch {}
    conn.release();
  }
});

app.get('/api/reservas', async (req, res) => {
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
  try {
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
      [id, cpf, 'CANCELAMENTO', `A reserva de ${r.nome} para ${r.data_reserva.split('-').reverse().join('/')} foi cancelada. A capacidade foi liberada.`]
    );
    await conn.commit();
    res.json({ mensagem: 'Reserva cancelada. A capacidade foi liberada.' });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error(e);
    erro(res, 500, 'Não foi possível cancelar a reserva.');
  } finally {
    conn.release();
  }
});

app.get('/api/notificacoes', async (req, res) => {
  const cpf = req.query.cpf ? cpfSoDigitos(req.query.cpf) : null;
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
