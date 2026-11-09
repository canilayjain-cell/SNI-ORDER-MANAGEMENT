-- ============================================================================
-- SNI Order System — migration 008: link design numbers to a door type
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Only design_number rows use this. A design number with no door type stays
-- selectable under every door type.
-- ============================================================================

alter table public.option_lists add column if not exists door_type text;

notify pgrst, 'reload schema';
