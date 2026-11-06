'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);
const sources = ['control', 'app'];
const built = sources.map(name => {
  const bytes = read('assets/' + name + '.js');
  const file = 'assets/' + name + '.' + hash(bytes) + '.js';
  fs.writeFileSync(path.join(root, file), bytes);
  return file;
});
const pattern = /<!-- VCN_BUILD_SCRIPTS -->[\s\S]*?<!-- VCN_BUILD_SCRIPTS_END -->/;
let html = read('index.html').toString();
if (!pattern.test(html)) throw new Error('Marcadores da publicação não encontrados');
const canonical = html.replace(pattern, '<!-- VCN_BUILD_SCRIPTS_CANONICAL -->');
const template = read('scripts/service-worker.template.js').toString();
const revision = hash(Buffer.concat([Buffer.from(canonical + template), read('manifest.json'), ...sources.map(n => read('assets/' + n + '.js'))]));
html = html.replace(pattern, '<!-- VCN_BUILD_SCRIPTS -->\n' + built.map(file => '<script src="./' + file + '"></script>').join('\n') + '\n<!-- VCN_BUILD_SCRIPTS_END -->');
fs.writeFileSync(path.join(root, 'index.html'), html);
const files = ['./index.html', './manifest.json', ...built.map(file => './' + file),
  './assets/icon-192.png', './assets/icon-512.png', './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png', './assets/apple-touch-icon.png', './assets/favicon.svg',
  './assets/fonts/inter.woff2', './assets/fonts/space-grotesk.woff2'];
for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error('Arquivo ausente: ' + file);
const worker = template.replace('__VCN_CACHE_VERSION__', 'vcn-control-v23-' + revision)
  .replace('__VCN_STATIC_FILES__', JSON.stringify(files, null, 2));
fs.writeFileSync(path.join(root, 'service-worker.js'), worker);
console.log('Arquivos de publicação gerados: ' + revision);
