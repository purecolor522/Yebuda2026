-- =====================================================================
-- YEBUDA — Supabase schema
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- =====================================================================

-- 1) Application data store ------------------------------------------------
-- One row per former data/*.json file. `data` holds the whole JSON document.
--   key = 'products' | 'orders' | 'carts' | 'customers'
--       | 'purchases' | 'stock-adjustments'
create table if not exists app_data (
  key        text primary key,
  data       jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- The server connects with the service_role key, which bypasses RLS.
-- Enabling RLS with no policies means the public anon key can read/write
-- nothing — exactly what we want (all access goes through the server).
alter table app_data enable row level security;

-- 2) Product image storage bucket -----------------------------------------
-- Public read so <img src> works in the browser; writes happen server-side
-- with the service_role key.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;
