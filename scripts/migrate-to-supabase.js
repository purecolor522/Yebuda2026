// =====================================================================
// One-time migration: push local data/*.json into the Supabase app_data table.
//
//   node scripts/migrate-to-supabase.js
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in .env, and the `app_data`
// table to exist (run supabase/schema.sql first).
//
// Safe to re-run: it upserts by key. Existing rows are overwritten with the
// local file contents, so only run when the local JSON is the source of truth.
// =====================================================================
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseEnabled, kvWrite } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// key -> default value when the file is missing
const FILES = {
  'products':          [],
  'orders':            [],
  'carts':             {},
  'customers':         [],
  'purchases':         [],
  'stock-adjustments': [],
};

if (!supabaseEnabled) {
  console.error('✗ SUPABASE_URL / SUPABASE_SERVICE_KEY not set in .env — nothing to migrate.');
  process.exit(1);
}

let ok = 0;
for (const [key, fallback] of Object.entries(FILES)) {
  const file = path.join(DATA_DIR, key + '.json');
  let data = fallback;
  try {
    data = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    console.log(`· ${key}: no local file, seeding empty`);
  }
  await kvWrite(key, data);
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`✓ ${key}: ${count} item(s) uploaded`);
  ok++;
}
console.log(`\nDone — ${ok} dataset(s) migrated to Supabase.`);
process.exit(0);
