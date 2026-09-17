'use strict';

// Add future product types here. Categories are managed in Square, not in Git.
const PRODUCT_TYPES = [
  { name: 'Sweatshirts', sizes: ['Small', 'Medium', 'Large', 'XL', '2XL'] },
  { name: 'Tote bags', sizes: ['Small', 'Large'] },
  { name: 'Makeup pouches', sizes: ['Small', 'Large'] }
];

function normalize(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function productType(categories) {
  return PRODUCT_TYPES.find(type => categories.some(name => normalize(name) === normalize(type.name)));
}

function sizeName(name, type) {
  const aliases = {
    s: 'Small', small: 'Small', m: 'Medium', medium: 'Medium', l: 'Large', large: 'Large',
    xl: 'XL', xlarge: 'XL', extralarge: 'XL', xxl: '2XL', '2xl': '2XL', '2x': '2XL', '2xlarge': '2XL'
  };
  const size = aliases[normalize(name)];
  return type?.sizes.includes(size) ? size : null;
}

module.exports = { PRODUCT_TYPES, productType, sizeName };
