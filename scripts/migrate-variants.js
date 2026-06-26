// =====================================================================
// One-time migration: give every product a per-variant stock table
// (顏色 × 尺寸)，all quantities reset to 0. Old single `stock` totals are
// discarded — you re-enter real numbers via 進貨 or 庫存盤點.
//
//   node scripts/migrate-variants.js
//
// Works on Supabase (if configured in .env) or the local data/products.json.
// Safe to re-run: variants already present keep their quantities.
// =====================================================================
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseEnabled, kvRead, kvWrite } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'data', 'products.json');

function buildVariants(p, resetToZero) {
  const colors = (Array.isArray(p.colors) && p.colors.length) ? p.colors
               : (p.color ? [p.color] : ['']);
  const sizes  = (Array.isArray(p.sizes) && p.sizes.length) ? p.sizes : ['FREE'];
  const old = Array.isArray(p.variants) ? p.variants : [];
  const next = [];
  for (const color of colors) {
    for (const size of sizes) {
      const ex = old.find(v => v.color === color && v.size === size);
      next.push({ color, size, qty: (ex && !resetToZero) ? Math.max(0, Number(ex.qty) || 0) : 0 });
    }
  }
  p.variants = next;
  p.stock = next.reduce((s, v) => s + v.qty, 0);
  return p;
}

let products;
if (supabaseEnabled) {
  products = await kvRead('products', []);
} else {
  products = JSON.parse(await fs.readFile(FILE, 'utf8'));
}

// First run (no variants anywhere) → reset to 0. Re-run → preserve existing variant qty.
const anyVariants = products.some(p => Array.isArray(p.variants) && p.variants.length);
const resetToZero = !anyVariants;

let combos = 0;
for (const p of products) { buildVariants(p, resetToZero); combos += p.variants.length; }

if (supabaseEnabled) await kvWrite('products', products);
else await fs.writeFile(FILE, JSON.stringify(products, null, 2));

console.log(`✓ ${products.length} 商品已建立變體庫存，共 ${combos} 個「顏色×尺寸」組合`);
console.log(resetToZero ? '  (首次遷移：庫存全歸零，請用進貨/盤點填入真實數量)'
                        : '  (已有變體：保留原數量)');
console.log(`  資料來源：${supabaseEnabled ? 'Supabase' : '本機 products.json'}`);
process.exit(0);
