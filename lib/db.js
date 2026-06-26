// =====================================================================
// Supabase-backed data layer.
//
// Design goal: ZERO changes to existing business logic.
// server.js keeps calling readJson(file, fallback) / writeJson(file, data)
// exactly as before. Those helpers just route here when Supabase is
// configured, and fall back to local JSON files when it is not (so local
// dev keeps working with no Supabase account).
//
// Storage model: each former JSON "file" becomes one row in the `app_data`
// table — key = file name without extension (products / orders / carts ...),
// data = the whole JSON document (a JSONB blob). This mirrors the old
// read-the-whole-file / write-the-whole-file behaviour exactly.
// =====================================================================
import { createClient } from '@supabase/supabase-js';

const url        = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET     = process.env.SUPABASE_BUCKET || 'product-images';

export const supabaseEnabled = Boolean(url && serviceKey);

export const supabase = supabaseEnabled
  ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// ---- Key/value document store (replaces data/*.json) ----
export async function kvRead(key, fallback) {
  const { data, error } = await supabase
    .from('app_data')
    .select('data')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    // First read: seed the row with the fallback, same as the old
    // "create the file if it doesn't exist" behaviour.
    const { error: insErr } = await supabase
      .from('app_data')
      .upsert({ key, data: fallback }, { onConflict: 'key' });
    if (insErr) throw insErr;
    return fallback;
  }
  return data.data;
}

export async function kvWrite(key, value) {
  const { error } = await supabase
    .from('app_data')
    .upsert({ key, data: value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

// ---- Image storage (replaces local /uploads disk writes) ----
export async function uploadImageToStorage(buffer, filename, contentType) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}
