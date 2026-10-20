const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const files = [
  path.join(root, 'server.js'),
  path.join(root, 'lib', 'validacoes.js'),
  path.join(root, 'tests', 'validacoes.test.js'),
  path.join(root, 'public', 'index.html'),
  path.join(root, 'public', 'painel-funcionarios.html'),
  path.join(root, 'public', 'login-funcionarios.html')
];
let failures = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    if (file.endsWith('.html')) {
      const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(s => s.trim());
      scripts.forEach((script, i) => new vm.Script(script, { filename: `${file}#script-${i + 1}` }));
    } else {
      new vm.Script(source, { filename: file });
    }
    console.log(`OK  ${path.relative(root, file)}`);
  } catch (error) {
    failures++;
    console.error(`ERRO ${path.relative(root, file)}: ${error.message}`);
  }
}
if (failures) process.exitCode = 1;
else console.log('\nVerificação de sintaxe concluída. Isso não substitui um teste com MySQL ativo.');
