require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const required = ['DB_HOST', 'DB_USER', 'DB_NAME'];
for (const key of required) if (!process.env[key]) { console.error(`Configure ${key} no arquivo .env.`); process.exit(1); }
const dir = path.resolve(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(dir, `reino-do-dragao-${stamp}.sql`);
const args = ['--host', process.env.DB_HOST, '--port', process.env.DB_PORT || '3306', '--user', process.env.DB_USER, '--single-transaction', '--routines', '--triggers', '--databases', process.env.DB_NAME];
const env = { ...process.env };
if (process.env.DB_PASSWORD) env.MYSQL_PWD = process.env.DB_PASSWORD;
const result = spawnSync('mysqldump', args, { encoding: 'utf8', env, maxBuffer: 50 * 1024 * 1024 });
if (result.error) { console.error('Não foi possível executar mysqldump. Instale o cliente MySQL e confira se ele está no PATH.'); process.exit(1); }
if (result.status !== 0 || !result.stdout?.trim()) { console.error(result.stderr || 'O backup não foi gerado.'); process.exit(1); }
fs.writeFileSync(output, result.stdout, { mode: 0o600, flag: 'wx' });
console.log(`Backup criado: ${output}`);
console.log('Guarde também uma cópia em outro local seguro.');
