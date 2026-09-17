'use strict';
// Local preview only. --demo is an explicit, non-published design fixture.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { PRODUCT_TYPES } = require('../api/shared/product-types');
const root = path.resolve(__dirname, '..');
const localSettings = path.join(root, 'api/local.settings.json');
if (fs.existsSync(localSettings)) Object.assign(process.env, JSON.parse(fs.readFileSync(localSettings, 'utf8')).Values);
const demo = process.argv.includes('--demo');
const api = { '/api/shop/products': require('../api/products'), '/api/shop/checkout': require('../api/checkout') };
const fixture = {
  preview: true,
  settings: { checkoutEnabled: false, sandbox: true, currency: 'USD', shippingFee: 799,
    collections: PRODUCT_TYPES.map(type => type.name),
    shippingDescription: 'Shipping starts at $7.99. Delivery area and final rate are awaiting setup.', pickupInstructions: 'Local pickup details will be available before checkout opens.' },
  products: [
    ['sample-sweatshirt', 'Embroidered sweatshirt', 4500, 'Sweatshirts'],
    ['sample-tote', 'Embroidered tote bag', 2400, 'Tote bags'],
    ['sample-pouch', 'Embroidered makeup pouch', 1600, 'Makeup pouches']
  ].map(([id, name, amount, category]) => ({ id, name,
    description: 'Sample price and stock for preview only. Your own photos, products and prices will come from Square.',
    image: null, categories: [category],
    variants: PRODUCT_TYPES.find(type => type.name === category).sizes.map((size, index) => ({
      id: `${id}-${index}`, name: size, price: amount, currency: 'USD', stock: 3
    })) }))
};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:4173');
    if (api[url.pathname]) {
      if ((url.pathname.endsWith('products') && req.method !== 'GET') || (url.pathname.endsWith('checkout') && req.method !== 'POST')) { res.writeHead(405).end(); return; }
      if (demo) { res.writeHead(url.pathname.endsWith('products') ? 200 : 503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(url.pathname.endsWith('products') ? fixture : { error: 'Design preview: payments are disabled.' })); return; }
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16000) { res.writeHead(413).end(); return; } }
      const context = { log: { error: message => console.error(message) } };
      await api[url.pathname](context, { headers: req.headers, body: raw ? JSON.parse(raw) : undefined });
      res.writeHead(context.res.status, context.res.headers); res.end(JSON.stringify(context.res.body)); return;
    }
    let file = decodeURIComponent(url.pathname);
    if (file === '/') file = '/index.html';
    if (file === '/shop' || file === '/shop/') file = '/shop.html';
    const candidate = path.resolve(root, `.${file}`);
    const relative = path.relative(root, candidate);
    const allowed = !relative.startsWith('..') && !path.isAbsolute(relative) && (/^[^/\\]+\.html$/.test(relative) || relative.startsWith(`assets${path.sep}`) || relative.startsWith(`images${path.sep}`));
    if (!allowed || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(candidate)] || 'application/octet-stream' }); fs.createReadStream(candidate).pipe(res);
  } catch { res.writeHead(500).end('Preview request failed'); }
}).listen(4173, '127.0.0.1', () => console.log(`Shop preview: http://localhost:4173/shop${demo ? ' (sample products, no payments)' : ''}`));
