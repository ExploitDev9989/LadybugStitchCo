'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { config, loadCatalog, publicSettings, checkout, validateCart } = require('../api/shared/shop');
const productsHandler = require('../api/products');
const checkoutHandler = require('../api/checkout');
const fs = require('node:fs');
const path = require('node:path');
const savedEnv = { ...process.env };
const originalFetch = global.fetch;
const item = (id = 'ITEM', extra = {}) => ({
  type: 'ITEM', id, present_at_all_locations: true,
  item_data: { name: 'Embroidered sweater', product_type: 'REGULAR', categories: [{ id: 'SHOP' }, { id: 'SEASON' }],
    image_ids: ['IMAGE'], variations: [{ id: `${id}-SMALL`, type: 'ITEM_VARIATION', present_at_all_locations: true,
      item_variation_data: { name: 'Small', pricing_type: 'FIXED_PRICING', price_money: { amount: 3500, currency: 'USD' }, track_inventory: true } }], ...extra }
});
let objects, counts, requests, customReply;
const cart = extra => ({ requestId: '01234567-89ab-cdef-0123-456789abcdef', fulfillment: 'shipping', items: [{ id: 'ITEM-SMALL', quantity: 1, expectedPrice: 3500 }], ...extra });
beforeEach(() => {
  Object.assign(process.env, { SQUARE_ENVIRONMENT: 'sandbox', SQUARE_ACCESS_TOKEN: 'TEST_ONLY_TOKEN', SQUARE_LOCATION_ID: 'LOCATION',
    SHOP_CHECKOUT_ENABLED: 'true', SHOP_SITE_ORIGIN: 'https://www.ladybugstitch.com', SHOP_CATEGORY_NAME: 'Website Shop',
    SHOP_CURRENCY: 'USD', SHOP_SHIPPING_FEE_CENTS: '799', SHOP_SHIPPING_DESCRIPTION: 'Test shipping instructions', SHOP_PICKUP_INSTRUCTIONS: 'Test pickup instructions' });
  objects = [ { type: 'CATEGORY', id: 'SHOP', category_data: { name: 'Website Shop' } },
    { type: 'CATEGORY', id: 'SEASON', category_data: { name: 'Christmas' } },
    { type: 'IMAGE', id: 'IMAGE', image_data: { url: 'https://images.example.test/sweater.jpg' } }, item() ];
  counts = [{ catalog_object_id: 'ITEM-SMALL', location_id: 'LOCATION', state: 'IN_STOCK', quantity: '3' }];
  requests = []; customReply = undefined;
  global.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body, options });
    const override = customReply?.(url, body);
    if (override) return override;
    let data;
    if (url.includes('/catalog/list')) data = { objects };
    else if (url.includes('/inventory/counts/')) data = { counts };
    else if (url.includes('/payment-links')) data = { payment_link: { url: 'https://sandbox.square.link/u/test' } };
    else throw new Error('Unexpected request');
    return { ok: true, json: async () => data };
  };
});
afterEach(() => { global.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key]; Object.assign(process.env, savedEnv); });

test('catalog exposes only opted-in ready-made inventory at the configured location', async () => {
  objects.push(item('PRIVATE', { categories: [] }), item('ARCHIVED', { is_archived: true }), item('SERVICE', { product_type: 'APPOINTMENTS_SERVICE' }), item('CUSTOM', { modifier_list_info: [{ enabled: true }] }));
  const absent = item('ABSENT'); absent.absent_at_location_ids = ['LOCATION']; objects.push(absent);
  const untracked = item('UNTRACKED'); untracked.item_data.variations[0].item_variation_data.track_inventory = false; objects.push(untracked);
  const products = await loadCatalog(config());
  assert.equal(products.length, 1);
  assert.equal(products[0].variants[0].stock, 3);
  assert.deepEqual(products[0].categories, ['Christmas']);
  assert.equal(products[0].image, 'https://images.example.test/sweater.jpg');
  assert.ok(!JSON.stringify(products).includes('TEST_ONLY_TOKEN'));
});

test('catalog handles pagination, location prices, inventory pages and missing stock', async () => {
  objects[3].item_data.variations[0].item_variation_data.location_overrides = [{ location_id: 'LOCATION', price_money: { amount: 3900, currency: 'USD' } }];
  const second = item('SECOND');
  customReply = url => ({ ok: true, json: async () => url.includes('/catalog/list')
    ? url.includes('cursor=next') ? { objects: [second] } : { objects, cursor: 'next' }
    : requests.at(-1).body.cursor ? { counts } : { counts: [], cursor: 'inventory-next' } });
  const products = await loadCatalog(config());
  assert.equal(products.length, 2);
  assert.equal(products.find(p => p.id === 'ITEM').variants[0].price, 3900);
  assert.equal(products.find(p => p.id === 'ITEM').variants[0].stock, 3);
  assert.equal(products.find(p => p.id === 'SECOND').variants[0].stock, 0);
});

test('shipping checkout uses catalog IDs, a server-side fee and catalog taxes', async () => {
  const result = await checkout(config(), cart({ price: 1, shippingFee: 0 }));
  const payload = requests.at(-1).body;
  assert.equal(result.url, 'https://sandbox.square.link/u/test');
  assert.deepEqual(payload.order.line_items, [{ catalog_object_id: 'ITEM-SMALL', quantity: '1' }]);
  assert.equal(payload.checkout_options.shipping_fee.charge.amount, 799);
  assert.equal(payload.checkout_options.ask_for_shipping_address, true);
  assert.equal(payload.order.pricing_options.auto_apply_taxes, true);
  assert.equal(payload.order.metadata.fulfillment, 'shipping');
  assert.equal(payload.checkout_options.redirect_url, 'https://www.ladybugstitch.com/shop?checkout=returned');
});

test('pickup checkout removes shipping and asks for pickup contact details', async () => {
  await checkout(config(), cart({ fulfillment: 'pickup' }));
  const payload = requests.at(-1).body;
  assert.equal(payload.checkout_options.shipping_fee, undefined);
  assert.equal(payload.checkout_options.ask_for_shipping_address, false);
  assert.equal(payload.checkout_options.custom_fields.length, 2);
  assert.equal(payload.order.metadata.fulfillment, 'pickup');
  assert.match(payload.payment_note, /Test pickup instructions/);
});

test('insufficient, missing or stale inventory cannot create a payment link', async () => {
  counts[0].quantity = '0';
  await assert.rejects(checkout(config(), cart()), { status: 409 });
  assert.ok(requests.every(r => !r.url.includes('/payment-links')));
  counts = [];
  await assert.rejects(checkout(config(), cart()), { status: 409 });
});

test('price changes require buyer review instead of silently changing the amount', async () => {
  await assert.rejects(checkout(config(), cart({ items: [{ id: 'ITEM-SMALL', quantity: 1, expectedPrice: 1 }] })), { status: 409 });
  assert.ok(requests.every(r => !r.url.includes('/payment-links')));
});

test('deleted or non-shop items cannot be purchased through a forged cart', async () => {
  await assert.rejects(checkout(config(), cart({ items: [{ id: 'PRIVATE-SMALL', quantity: 1, expectedPrice: 3500 }] })), { status: 409 });
});

test('cart rejects invalid quantities, duplicate IDs, excess lines and invalid fulfillment', () => {
  for (const quantity of [0, -1, 1.5, 21, '1']) assert.throws(() => validateCart(cart({ items: [{ id: 'ITEM-SMALL', quantity, expectedPrice: 3500 }] })), { status: 400 });
  assert.throws(() => validateCart(cart({ items: [cart().items[0], cart().items[0]] })), { status: 400 });
  assert.throws(() => validateCart(cart({ items: Array(31).fill(cart().items[0]) })), { status: 400 });
  assert.throws(() => validateCart(cart({ fulfillment: 'delivery' })), { status: 400 });
  assert.throws(() => validateCart(cart({ requestId: '' })), { status: 400 });
});

test('retries use one idempotency key while changed fulfillment changes the key', async () => {
  await checkout(config(), cart()); const first = requests.at(-1).body.idempotency_key;
  await checkout(config(), cart()); assert.equal(requests.at(-1).body.idempotency_key, first);
  await checkout(config(), cart({ fulfillment: 'pickup' })); assert.notEqual(requests.at(-1).body.idempotency_key, first);
});

test('missing credentials, shipping or pickup configuration keeps checkout closed', async () => {
  for (const key of ['SHOP_SHIPPING_DESCRIPTION', 'SHOP_PICKUP_INSTRUCTIONS', 'SHOP_SHIPPING_FEE_CENTS', 'SHOP_SITE_ORIGIN']) {
    const prior = process.env[key]; process.env[key] = '';
    assert.equal(publicSettings(config()).checkoutEnabled, false);
    await assert.rejects(checkout(config(), cart()), { status: 503 });
    process.env[key] = prior;
  }
  delete process.env.SQUARE_ACCESS_TOKEN;
  const ctx = {}; await productsHandler(ctx);
  assert.equal(ctx.res.status, 503);
  assert.equal(requests.length, 0);
});

test('Square failure fails closed and does not expose upstream error details', async () => {
  customReply = () => ({ ok: false, json: async () => ({ errors: [{ detail: 'SECRET ACCOUNT DATA' }] }) });
  const ctx = {}; await productsHandler(ctx);
  assert.equal(ctx.res.status, 503);
  assert.ok(!JSON.stringify(ctx.res).includes('SECRET'));
  assert.equal(ctx.res.headers['Cache-Control'], 'no-store');
});

test('checkout endpoint rejects cross-origin and non-JSON requests', async () => {
  const ctx = {};
  await checkoutHandler(ctx, { headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: cart() });
  assert.equal(ctx.res.status, 403);
  await checkoutHandler(ctx, { headers: { origin: process.env.SHOP_SITE_ORIGIN, 'content-type': 'text/plain' }, body: cart() });
  assert.equal(ctx.res.status, 415);
  assert.equal(requests.length, 0);
});

test('checkout endpoint returns a Square URL for an authorized website request', async () => {
  const ctx = {};
  await checkoutHandler(ctx, { headers: { origin: process.env.SHOP_SITE_ORIGIN, 'content-type': 'application/json' }, body: cart() });
  assert.equal(ctx.res.status, 200);
  assert.equal(ctx.res.body.url, 'https://sandbox.square.link/u/test');
});

test('unsafe product image URLs and non-Square checkout redirects are blocked', async () => {
  objects[2].image_data.url = 'javascript:alert(1)';
  assert.equal((await loadCatalog(config()))[0].image, null);
  customReply = url => url.includes('/payment-links') ? { ok: true, json: async () => ({ payment_link: { url: 'https://square.link.attacker.test/pay' } }) } : undefined;
  await assert.rejects(checkout(config(), cart()), { status: 503 });
});

test('build exports public assets without API source, docs or sample products', () => {
  require('../scripts/build');
  const dist = path.resolve(__dirname, '../dist');
  for (const file of ['index.html', 'shop.html', 'assets/shop.js', 'assets/shop.css', 'staticwebapp.config.json']) assert.ok(fs.existsSync(path.join(dist, file)));
  for (const name of ['api', 'tests', 'scripts', '.git', 'SHOP_SETUP.md']) assert.equal(fs.existsSync(path.join(dist, name)), false);
});

test('Azure routes remain unique after trailing-slash normalization', () => {
  const routing = require('../staticwebapp.config.json');
  const normalized = routing.routes.map(rule => rule.route.replace(/\/+$/, '').toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length);
  assert.equal(routing.routes.find(rule => rule.route === '/shop').rewrite, '/shop.html');
});
