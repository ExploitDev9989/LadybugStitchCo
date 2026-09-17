'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
// Only public files are copied. API source, credentials, tests and docs stay out.
for (const name of fs.readdirSync(root)) {
  if (/\.(html|png)$/.test(name) || ['images', 'assets', 'staticwebapp.config.json'].includes(name)) {
    fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
  }
}
console.log('Public website built in dist/');
