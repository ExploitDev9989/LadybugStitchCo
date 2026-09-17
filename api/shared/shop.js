'use strict';
const { createHash } = require('node:crypto');
const { PRODUCT_TYPES, productType, sizeName } = require('./product-types');

class ShopError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function config() {
  const env = process.env;
  const environment = env.SQUARE_ENVIRONMENT || 'sandbox';
  if (!['sandbox', 'production'].includes(environment)) throw new ShopError(503, 'The shop is temporarily unavailable.');
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) throw new ShopError(503, 'Our online shop is getting ready. Please check back soon.');
  const shippingFee = /^\d+$/.test(env.SHOP_SHIPPING_FEE_CENTS || '') ? Number(env.SHOP_SHIPPING_FEE_CENTS) : null;
  const origin = env.SHOP_SITE_ORIGIN || '';
  const validOrigin = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin) || (environment === 'sandbox' && /^http:\/\/localhost:\d+$/.test(origin));
  const shippingDescription = (env.SHOP_SHIPPING_DESCRIPTION || '').trim();
  const pickupInstructions = (env.SHOP_PICKUP_INSTRUCTIONS || '').trim();
  const currency = env.SHOP_CURRENCY || 'USD';
  const ready = env.SHOP_CHECKOUT_ENABLED === 'true' && validOrigin && /^[A-Z]{3}$/.test(currency)
    && Number.isSafeInteger(shippingFee) && shippingFee >= 0 && shippingFee <= 100000
    && !!shippingDescription && !!pickupInstructions;
  return {
    token: env.SQUARE_ACCESS_TOKEN, locationId: env.SQUARE_LOCATION_ID, environment,
    base: environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com',
    category: env.SHOP_CATEGORY_NAME || 'Website Shop', currency, origin,
    shippingFee, shippingDescription, pickupInstructions, ready
  };
}

async function square(cfg, endpoint, body) {
  let response;
  try {
    response = await fetch(`${cfg.base}/v2${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Square-Version': '2026-09-16', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || data.errors?.length) throw new Error('Square request failed');
    return data;
  } catch {
    // Never expose Square responses (which may contain account details) or tokens.
    throw new ShopError(503, 'We couldn’t reach the shop. Please try again in a moment.');
  }
}

function atLocation(object, locationId) {
  if (object.is_deleted || object.absent_at_location_ids?.includes(locationId)) return false;
  return object.present_at_all_locations === true || object.present_at_location_ids?.includes(locationId) === true;
}

function httpsImage(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

async function loadCatalog(cfg) {
  const objects = [];
  let cursor;
  const seen = new Set();
  do {
    const page = await square(cfg, `/catalog/list?types=ITEM,CATEGORY,IMAGE${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    objects.push(...(page.objects || []));
    cursor = page.cursor;
    if (cursor && seen.has(cursor)) throw new ShopError(503, 'The shop is temporarily unavailable.');
    seen.add(cursor);
  } while (cursor);
  const categories = new Map(objects.filter(o => o.type === 'CATEGORY' && !o.is_deleted).map(o => [o.id, o.category_data?.name]));
  const allowed = new Set([...categories].filter(([, name]) => name === cfg.category).map(([id]) => id));
  const images = new Map(objects.filter(o => o.type === 'IMAGE' && !o.is_deleted).map(o => [o.id, httpsImage(o.image_data?.url)]));
  const products = [];
  for (const item of objects.filter(o => o.type === 'ITEM')) {
    const data = item.item_data;
    if (!data || data.is_archived || !atLocation(item, cfg.locationId) || (data.product_type && data.product_type !== 'REGULAR')) continue;
    const categoryIds = [...(data.categories || []).map(c => c.id), data.category_id].filter(Boolean);
    if (!categoryIds.some(id => allowed.has(id))) continue;
    const type = productType(categoryIds.map(id => categories.get(id)).filter(Boolean));
    if (!type) continue;
    // This ready-made shop does not support required personalization/modifiers.
    if ((data.modifier_list_info || []).some(m => m.enabled !== false)) continue;
    const variants = [];
    for (const variant of data.variations || []) {
      const v = variant.item_variation_data;
      if (!v || !atLocation(variant, cfg.locationId) || v.sellable === false || v.measurement_unit_id) continue;
      const size = sizeName(v.name, type);
      if (!size) continue;
      const override = v.location_overrides?.find(o => o.location_id === cfg.locationId) || {};
      const money = override.price_money || v.price_money;
      const tracked = override.track_inventory ?? v.track_inventory;
      if ((override.pricing_type || v.pricing_type) !== 'FIXED_PRICING' || !tracked || override.sold_out
        || !Number.isSafeInteger(money?.amount) || money.amount <= 0 || money.currency !== cfg.currency) continue;
      variants.push({ id: variant.id, name: size, price: money.amount, currency: money.currency, stock: 0,
        image: (v.image_ids || []).map(id => images.get(id)).find(Boolean) || null });
    }
    if (variants.length) products.push({
      id: item.id, name: data.name || 'Handmade item', description: data.description_plaintext || data.description || '',
      image: (data.image_ids || []).map(id => images.get(id)).find(Boolean) || null,
      categories: [type.name], variants: variants.sort((a, b) => type.sizes.indexOf(a.name) - type.sizes.indexOf(b.name))
    });
  }
  const ids = products.flatMap(p => p.variants.map(v => v.id));
  const quantities = new Map();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    cursor = undefined;
    const inventoryCursors = new Set();
    do {
      const page = await square(cfg, '/inventory/counts/batch-retrieve', {
        catalog_object_ids: ids.slice(offset, offset + 1000), location_ids: [cfg.locationId], states: ['IN_STOCK'], ...(cursor ? { cursor } : {})
      });
      for (const count of page.counts || []) {
        if (count.state === 'IN_STOCK' && count.location_id === cfg.locationId && !quantities.has(count.catalog_object_id)) {
          const n = Number(count.quantity);
          quantities.set(count.catalog_object_id, Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
        }
      }
      cursor = page.cursor;
      if (cursor && inventoryCursors.has(cursor)) throw new ShopError(503, 'The shop is temporarily unavailable.');
      inventoryCursors.add(cursor);
    } while (cursor);
  }
  for (const product of products) for (const v of product.variants) v.stock = quantities.get(v.id) || 0;
  return products.sort((a, b) => a.name.localeCompare(b.name));
}

function publicSettings(cfg) {
  return { checkoutEnabled: cfg.ready, currency: cfg.currency, shippingFee: cfg.shippingFee,
    collections: PRODUCT_TYPES.map(type => type.name),
    shippingDescription: cfg.shippingDescription, pickupInstructions: cfg.pickupInstructions,
    sandbox: cfg.environment === 'sandbox' };
}

function validateCart(body) {
  if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length > 30) throw new ShopError(400, 'Please add between 1 and 30 items to your bag.');
  if (!['shipping', 'pickup'].includes(body.fulfillment)) throw new ShopError(400, 'Choose shipping or local pickup.');
  if (typeof body.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.requestId)) throw new ShopError(400, 'Please refresh the page and try again.');
  const ids = new Set();
  const items = body.items.map(item => {
    if (!item || typeof item.id !== 'string' || item.id.length > 192 || ids.has(item.id)
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20
      || !Number.isSafeInteger(item.expectedPrice) || item.expectedPrice < 1) throw new ShopError(400, 'Please review the quantities in your bag.');
    ids.add(item.id);
    return { id: item.id, quantity: item.quantity, expectedPrice: item.expectedPrice };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { items, fulfillment: body.fulfillment, requestId: body.requestId };
}

async function checkout(cfg, input) {
  const cart = validateCart(input);
  if (!cfg.ready) throw new ShopError(503, 'Online checkout is not available yet. Please check back soon.');
  // Always re-read prices, eligibility and inventory. The browser cannot set a price.
  const products = await loadCatalog(cfg);
  const variants = new Map(products.flatMap(p => p.variants.map(v => [v.id, { ...v, product: p.name }])));
  const lines = cart.items.map(item => {
    const v = variants.get(item.id);
    if (!v || v.stock < item.quantity) throw new ShopError(409, 'An item in your bag is no longer available in that quantity. Refresh the shop and review your bag.');
    if (v.price !== item.expectedPrice) throw new ShopError(409, 'An item’s price has changed. Refresh the shop and review your bag before continuing.');
    return { catalog_object_id: v.id, quantity: String(item.quantity) };
  });
  const options = { allow_tipping: false, ask_for_shipping_address: cart.fulfillment === 'shipping',
    redirect_url: `${cfg.origin}/shop?checkout=returned` };
  if (cart.fulfillment === 'shipping') {
    options.shipping_fee = { name: 'Shipping', charge: { amount: cfg.shippingFee, currency: cfg.currency } };
  } else {
    options.custom_fields = [{ title: 'Pickup contact name' }, { title: 'Pickup phone number' }];
  }
  // Same logical attempt produces the same Square request, including on retry.
  const order = {
    location_id: cfg.locationId,
    line_items: lines,
    pricing_options: { auto_apply_taxes: true },
    metadata: { source: 'ladybugstitch.com', fulfillment: cart.fulfillment },
    ...(cart.fulfillment === 'pickup' ? { ticket_name: 'Website pickup' } : {})
  };
  const payload = { order, checkout_options: options,
    payment_note: `Website ${cart.fulfillment} order. ${cart.fulfillment === 'pickup' ? cfg.pickupInstructions : cfg.shippingDescription}`.slice(0, 500) };
  const key = createHash('sha256').update(JSON.stringify({ requestId: cart.requestId, ...payload })).digest('hex');
  const result = await square(cfg, '/online-checkout/payment-links', { idempotency_key: key, ...payload });
  let url;
  try { url = new URL(result.payment_link?.url); } catch { throw new ShopError(503, 'Checkout could not be opened. Please try again.'); }
  const checkoutHosts = cfg.environment === 'sandbox' ? ['sandbox.square.link', 'connect.squareupsandbox.com'] : ['square.link', 'checkout.square.site'];
  if (url.protocol !== 'https:' || !checkoutHosts.includes(url.hostname)) {
    throw new ShopError(503, 'Checkout could not be opened. Please try again.');
  }
  return { url: url.href };
}

function reply(context, status, body) {
  context.res = { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body };
}
function handleError(context, error) {
  if (!(error instanceof ShopError)) context.log?.error?.('Unexpected shop error');
  reply(context, error instanceof ShopError ? error.status : 503,
    { error: error instanceof ShopError ? error.message : 'The shop is temporarily unavailable. Please try again.' });
}
module.exports = { config, square, loadCatalog, publicSettings, validateCart, checkout, ShopError, reply, handleError };
