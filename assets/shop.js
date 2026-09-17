'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const storageKey = 'ladybug-shop-bag-v1';
  const requestKey = 'ladybug-shop-attempt-v1';
  const fulfillmentKey = 'ladybug-shop-fulfillment-v1';
  let products = [], settings = {}, bag = [], loaded = false, busy = false;
  let fulfillment = 'shipping';
  const getStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const setStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Shopping still works without storage. */ } };
  if (getStored(fulfillmentKey) === 'pickup') fulfillment = 'pickup';
  document.querySelector(`input[name="fulfillment"][value="${fulfillment}"]`).checked = true;
  try {
    const stored = JSON.parse(getStored(storageKey));
    if (Array.isArray(stored)) {
      const seen = new Set();
      bag = stored.filter(v => v && typeof v.id === 'string' && !seen.has(v.id) && seen.add(v.id)
        && Number.isInteger(v.quantity) && v.quantity > 0 && v.quantity <= 20).slice(0, 30).map(v => ({ id: v.id, quantity: v.quantity }));
    }
  } catch { /* A damaged saved bag should not prevent shopping. */ }
  function element(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function price(cents) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: settings.currency || 'USD' }).format(cents / 100); }
  function lookup(id) {
    for (const product of products) { const variant = product.variants.find(v => v.id === id); if (variant) return { product, variant }; }
    return null;
  }
  function save() { setStored(storageKey, JSON.stringify(bag)); setStored(requestKey, ''); }
  function announce(text) { $('announcement').textContent = text; }
  function count(id) { return bag.find(v => v.id === id)?.quantity || 0; }
  function selectedFulfillmentNote() {
    if (fulfillment === 'shipping') return settings.shippingDescription || 'Shipping details will be available before checkout opens.';
    return settings.pickupInstructions || 'Pickup details will be available before checkout opens.';
  }
  function renderBag() {
    $('bag-items').replaceChildren();
    let subtotal = 0, valid = true;
    for (const item of bag) {
      const entry = lookup(item.id);
      const row = element('li', 'bag-item');
      const heading = element('div', 'bag-item-heading');
      heading.append(element('span', 'bag-item-name', entry?.product.name || (loaded ? 'Item no longer available' : 'Loading saved item…')),
        element('span', '', entry ? price(entry.variant.price * item.quantity) : '—'));
      row.append(heading, element('p', 'bag-variant', entry?.variant.name || ''));
      const controls = element('div', 'quantity-row');
      const quantity = element('div', 'quantity-controls');
      const minus = element('button', '', '−'); minus.type = 'button'; minus.disabled = busy;
      minus.setAttribute('aria-label', `Decrease quantity of ${entry?.product.name || 'item'}`);
      minus.addEventListener('click', () => changeQuantity(item.id, -1));
      const plus = element('button', '', '+'); plus.type = 'button';
      plus.setAttribute('aria-label', `Increase quantity of ${entry?.product.name || 'item'}`);
      plus.disabled = busy || !entry || item.quantity >= Math.min(entry.variant.stock, 20);
      plus.addEventListener('click', () => changeQuantity(item.id, 1));
      quantity.append(minus, element('span', '', String(item.quantity)), plus);
      const remove = element('button', 'remove-item', 'Remove'); remove.type = 'button'; remove.disabled = busy;
      remove.setAttribute('aria-label', `Remove ${entry?.product.name || 'item'} from bag`);
      remove.addEventListener('click', () => { bag = bag.filter(v => v.id !== item.id); save(); renderBag(); refreshAddButtons(); announce('Item removed from bag.'); });
      controls.append(quantity, remove); row.append(controls);
      if (loaded && (!entry || entry.variant.stock < item.quantity)) {
        valid = false; row.append(element('p', 'unavailable', 'Please remove this item or reduce its quantity.'));
      }
      $('bag-items').append(row);
      if (entry) subtotal += entry.variant.price * item.quantity;
    }
    $('bag-count').textContent = bag.reduce((n, v) => n + v.quantity, 0);
    $('empty-bag').hidden = bag.length > 0;
    $('subtotal').textContent = price(subtotal);
    $('shipping-label').textContent = Number.isInteger(settings.shippingFee) ? `From ${price(settings.shippingFee)}` : 'Rate shown before checkout';
    $('delivery-total-label').textContent = fulfillment === 'shipping' ? 'Shipping' : 'Local pickup';
    $('delivery-total').textContent = fulfillment === 'pickup' ? 'Free' : bag.length && Number.isInteger(settings.shippingFee) ? price(settings.shippingFee) : '—';
    $('fulfillment-note').textContent = selectedFulfillmentNote();
    $('fulfillment').disabled = busy;
    $('clear-bag').disabled = busy;
    $('checkout').disabled = busy || !loaded || !valid || !bag.length || !settings.checkoutEnabled;
  }
  function changeQuantity(id, delta) {
    const item = bag.find(v => v.id === id);
    const entry = lookup(id);
    if (!item || busy) return;
    if (delta > 0 && (!entry || item.quantity >= Math.min(entry.variant.stock, 20))) return;
    item.quantity += delta;
    if (item.quantity <= 0) bag = bag.filter(v => v.id !== id);
    save(); renderBag(); refreshAddButtons(); announce('Bag updated.');
  }
  function refreshAddButtons() {
    for (const card of $('products').children) card.dispatchEvent(new Event('update-add'));
  }
  function renderProducts() {
    $('products').replaceChildren();
    const query = $('search').value.trim().toLowerCase(), category = $('category').value;
    const filtered = products.filter(p => (!category || p.categories.includes(category)) && `${p.name} ${p.description} ${p.categories.join(' ')}`.toLowerCase().includes(query));
    $('product-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'piece' : 'pieces'}`;
    $('catalog-status').textContent = filtered.length ? '' : products.length ? 'No pieces match your search. Try another word or collection.' : 'New pieces are on the way. Check back soon, or ask us about a custom order.';
    $('catalog-status').hidden = filtered.length > 0;
    for (const product of filtered) {
      const card = element('article', 'product-card');
      const photo = element('div', 'product-photo');
      const image = element('img'); image.loading = 'lazy'; image.alt = product.name;
      const placeholder = element('span', 'photo-placeholder', 'A little handmade happiness');
      const badge = element('span', 'stock-badge');
      photo.append(image, placeholder, badge);
      image.addEventListener('error', () => { image.hidden = true; placeholder.hidden = false; });
      const meta = element('div', 'product-meta');
      const top = element('div', 'product-top');
      const amount = element('span', 'price');
      top.append(element('h3', '', product.name), amount);
      const description = element('p', 'product-description', product.description);
      const actions = element('div', 'product-actions');
      const label = element('label', 'variant-label', 'Size / option');
      const select = element('select'); select.setAttribute('aria-label', `Size or option for ${product.name}`);
      for (const variant of product.variants) {
        const option = element('option', '', `${variant.name}${variant.stock ? '' : ' — sold out'}`);
        option.value = variant.id; select.append(option);
      }
      select.value = (product.variants.find(v => v.stock > 0) || product.variants[0]).id;
      label.append(select);
      const add = element('button', 'add-button', 'Add to bag'); add.type = 'button';
      function update() {
        const variant = product.variants.find(v => v.id === select.value);
        amount.textContent = price(variant.price);
        const url = variant.image || product.image;
        const safe = typeof url === 'string' && url.startsWith('https://');
        image.hidden = !safe; placeholder.hidden = safe;
        if (safe && image.getAttribute('src') !== url) image.src = url;
        badge.textContent = variant.stock === 0 ? 'Sold out' : variant.stock <= 3 ? `Only ${variant.stock} left` : 'Ready-made';
        add.disabled = busy || variant.stock === 0 || count(variant.id) >= Math.min(variant.stock, 20);
        add.textContent = variant.stock === 0 ? 'Sold out' : count(variant.id) >= Math.min(variant.stock, 20) ? 'In your bag' : 'Add to bag';
        select.disabled = busy;
      }
      select.addEventListener('change', update); card.addEventListener('update-add', update);
      add.addEventListener('click', () => {
        const variant = product.variants.find(v => v.id === select.value);
        if (busy || count(variant.id) >= Math.min(variant.stock, 20)) return;
        const item = bag.find(v => v.id === variant.id);
        if (item) item.quantity++; else if (bag.length < 30) bag.push({ id: variant.id, quantity: 1 });
        else { announce('Your bag can hold up to 30 different options.'); return; }
        save(); renderBag(); update(); announce(`${product.name}, ${variant.name}, added to your bag.`);
      });
      actions.append(label, add); meta.append(top, description, actions); card.append(photo, meta); $('products').append(card); update();
    }
  }
  async function load() {
    loaded = false;
    $('retry').hidden = true; $('catalog-status').hidden = false;
    $('catalog-status').textContent = 'Gathering the latest stitches…'; $('products').setAttribute('aria-busy', 'true');
    $('checkout-status').textContent = ''; renderBag();
    try {
      const response = await fetch('/api/shop/products', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The shop is temporarily unavailable. Please try again.');
      if (!Array.isArray(data.products) || !data.settings) throw new Error('The shop is temporarily unavailable. Please try again.');
      products = data.products; settings = data.settings; loaded = true;
      $('demo-notice').hidden = !data.preview;
      $('category').replaceChildren(element('option', '', 'All collections'));
      $('category').firstChild.value = '';
      for (const name of [...new Set(products.flatMap(p => p.categories))].sort()) {
        const option = element('option', '', name); option.value = name; $('category').append(option);
      }
      renderProducts(); renderBag();
      if (!settings.checkoutEnabled) $('checkout-status').textContent = data.preview ? 'Preview only — no payment will be taken.' : 'Online checkout is getting ready. Please check back soon.';
      else if (settings.sandbox) $('checkout-status').textContent = 'Test checkout — no live payments.';
    } catch (error) {
      $('products').replaceChildren(); products = []; settings = {}; loaded = false;
      $('product-count').textContent = '';
      $('catalog-status').textContent = error.name === 'SyntaxError' || error.name === 'TimeoutError' ? 'The shop is temporarily unavailable. Please try again.' : error.message;
      $('retry').hidden = false; renderBag();
    } finally { $('products').setAttribute('aria-busy', 'false'); }
  }
  $('search').addEventListener('input', () => { if (loaded) renderProducts(); });
  $('category').addEventListener('change', () => { if (loaded) renderProducts(); });
  $('retry').addEventListener('click', load);
  for (const input of document.querySelectorAll('input[name="fulfillment"]')) input.addEventListener('change', () => {
    fulfillment = input.value; setStored(fulfillmentKey, fulfillment); setStored(requestKey, ''); renderBag();
  });
  $('clear-bag').addEventListener('click', () => { bag = []; save(); renderBag(); refreshAddButtons(); announce('Bag cleared.'); });
  if (new URLSearchParams(location.search).get('checkout') === 'returned') $('return-notice').hidden = false;
  $('checkout').addEventListener('click', async () => {
    if ($('checkout').disabled || busy) return;
    busy = true; renderBag(); refreshAddButtons(); $('checkout-status').textContent = 'Checking availability and opening secure checkout…';
    let requestId = getStored(requestKey);
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '')) { requestId = crypto.randomUUID(); setStored(requestKey, requestId); }
    try {
      const response = await fetch('/api/shop/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(55000),
        body: JSON.stringify({ requestId, fulfillment, items: bag.map(item => ({ ...item, expectedPrice: lookup(item.id).variant.price })) })
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) { await load(); setStored(requestKey, ''); }
        throw new Error(data.error || 'Checkout is unavailable. Please try again.');
      }
      const url = new URL(data.url);
      const checkoutHosts = settings.sandbox ? ['sandbox.square.link', 'connect.squareupsandbox.com'] : ['square.link', 'checkout.square.site'];
      if (url.protocol !== 'https:' || !checkoutHosts.includes(url.hostname)) throw new Error('Checkout is unavailable. Please try again.');
      location.assign(url.href);
    } catch (error) {
      $('checkout-status').textContent = error.name === 'TimeoutError' ? 'Checkout took too long. Your bag is saved; please try again.' : error.name === 'SyntaxError' ? 'Checkout is temporarily unavailable. Please try again.' : error.message;
      busy = false; renderBag(); refreshAddButtons();
    }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) { busy = false; load(); } });
  renderBag(); load();
})();
