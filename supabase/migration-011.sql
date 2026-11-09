-- ============================================================================
-- SNI Order System — migration 011: raw material requirements
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- One shared list that every signed-in staff member can add to and update.
-- A row is deleted when it is marked Completed, so this table only ever holds
-- open requirements.
-- ============================================================================

create table if not exists public.raw_materials (
  id uuid primary key default gen_random_uuid(),
  material text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  needed_by date,
  notes text,
  status text not null default 'order_placed' check (status in ('order_placed','in_dispatch','delivered')),
  requested_by_name text,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.raw_materials enable row level security;

drop policy if exists "raw_materials: signed-in staff manage" on public.raw_materials;
create policy "raw_materials: signed-in staff manage" on public.raw_materials
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

grant select, insert, update, delete on public.raw_materials to authenticated;

notify pgrst, 'reload schema';
