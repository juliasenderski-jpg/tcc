require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const fileArg = process.argv[2];
if (!fileArg || process.argv[3] !== '--confirm') {
  console.error('Uso: npm run restore -- caminho/do/backup.sql --confirm');
  console.error('ATENÇÃO: a restauração pode substituir dados existentes. Faça um backup atual antes de continuar.');
  process.exit(1);
}
const file = path.resolve(fileArg);
if (!fs.existsSync(file) || !fs.statSync(file).isFile() || path.extname(file).toLowerCase() !== '.sql') {
  console.error('Informe um arquivo .sql existente.'); process.exit(1);
}
for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME']) if (!process.env[key]) { console.error(`Configure ${key} no arquivo .env.`); process.exit(1); }
console.log(`Restaurando ${file} no banco configurado em .env (${process.env.DB_NAME}).`);
const args = ['--host', process.env.DB_HOST, '--port', process.env.DB_PORT || '3306', '--user', process.env.DB_USER, process.env.DB_NAME];
const env = { ...process.env };
if (process.env.DB_PASSWORD) env.MYSQL_PWD = process.env.DB_PASSWORD;
const input = fs.readFileSync(file);
const result = spawnSync('mysql', args, { input, env, stdio: ['pipe', 'inherit', 'inherit'], maxBuffer: 50 * 1024 * 1024 });
if (result.error) { console.error('Não foi possível executar mysql. Instale o cliente MySQL e confira se ele está no PATH.'); process.exit(1); }
if (result.status !== 0) { console.error('A restauração falhou. Confira o arquivo, as permissões e o banco.'); process.exit(result.status || 1); }
console.log('Comando de restauração finalizado. Verifique as tabelas e os dados no MySQL Workbench antes de reabrir o sistema.');
