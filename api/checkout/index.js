'use strict';
const { config, checkout, ShopError, reply, handleError } = require('../shared/shop');
module.exports = async (context, req) => {
  try {
    const cfg = config();
    if (req.headers?.origin !== cfg.origin) throw new ShopError(403, 'Please start checkout from our website.');
    if (!(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) throw new ShopError(415, 'Please refresh the page and try again.');
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > 16000) throw new ShopError(413, 'Your bag is too large.');
    reply(context, 200, await checkout(cfg, req.body));
  } catch (error) { handleError(context, error); }
};
