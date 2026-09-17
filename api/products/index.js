'use strict';
const { config, loadCatalog, publicSettings, reply, handleError } = require('../shared/shop');
module.exports = async context => {
  try {
    const cfg = config();
    reply(context, 200, { products: await loadCatalog(cfg), settings: publicSettings(cfg) });
  } catch (error) { handleError(context, error); }
};
