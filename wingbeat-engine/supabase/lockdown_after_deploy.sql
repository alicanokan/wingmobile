-- ============================================================================
--  Wingbeat cloud lockdown — RUN ONLY AFTER the RPC-based client (cloud.ts
--  using wingbeat_push_live / wingbeat_save_preset / …) is deployed to
--  wingbeat.art. Running it earlier breaks "Push live" on the old client.
--
--  What it does: the public role becomes READ-ONLY on all wingbeat tables;
--  every write goes through the SECURITY DEFINER functions (created by the
--  `wingbeat_secret_gated_writes` migration, 2026-08-17), which check the
--  conductor secret stored in the private wingbeat_config table.
--
--  Apply via Claude (Supabase MCP) or paste into the Supabase SQL editor.
-- ============================================================================

-- Tables: drop the wide-open ALL policies, keep read (devices + realtime).
drop policy if exists "wingbeat live open" on public.wingbeat_live;
drop policy if exists "wingbeat presets open" on public.wingbeat_presets;
drop policy if exists "wingbeat samples open" on public.wingbeat_samples;

create policy "wingbeat live read" on public.wingbeat_live
  for select using (true);
create policy "wingbeat presets read" on public.wingbeat_presets
  for select using (true);
create policy "wingbeat samples read" on public.wingbeat_samples
  for select using (true);

-- Storage: keep public READ (sampleUrl serves from the public endpoint) and
-- INSERT (raw bytes are invisible to devices until registered through the
-- secret-gated RPC), drop public UPDATE (no overwriting existing samples)
-- and DELETE (no wiping the library).
drop policy if exists "wingbeat samples bucket update" on storage.objects;
drop policy if exists "wingbeat samples bucket delete" on storage.objects;
