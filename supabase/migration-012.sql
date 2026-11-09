-- ============================================================================
-- SNI Order System — migration 012: voice notes on raw material requirements
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Signed-in staff can record, play and remove voice notes. Removal needs both
-- the select and delete policies. Marking a requirement Completed removes its
-- voice note too.
-- ============================================================================

alter table public.raw_materials add column if not exists voice_note_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('voice-notes', 'voice-notes', true, 10485760, array['audio/mp4','audio/webm'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "voice-notes: staff upload" on storage.objects;
create policy "voice-notes: staff upload" on storage.objects
  for insert with check (bucket_id = 'voice-notes' and auth.role() = 'authenticated');

drop policy if exists "voice-notes: staff read" on storage.objects;
create policy "voice-notes: staff read" on storage.objects
  for select using (bucket_id = 'voice-notes' and auth.role() = 'authenticated');

drop policy if exists "voice-notes: staff delete" on storage.objects;
create policy "voice-notes: staff delete" on storage.objects
  for delete using (bucket_id = 'voice-notes' and auth.role() = 'authenticated');

notify pgrst, 'reload schema';
