-- ============================================================================
-- SNI Order System — migration 006: machinery
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- A list of machines, each with a status. Admins manage the list; floor
-- managers can see it and change a machine's status, nothing else.
-- ============================================================================

create table if not exists public.machines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'working' check (status in ('working','not_working','in_service')),
  created_at timestamptz not null default now()
);

-- "CNC 1" and "cnc 1" are the same machine
create unique index if not exists machines_name_idx on public.machines (lower(btrim(name)));

alter table public.machines enable row level security;

drop policy if exists "machines: admin manages all" on public.machines;
create policy "machines: admin manages all" on public.machines
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "machines: floor manager reads" on public.machines;
create policy "machines: floor manager reads" on public.machines
  for select using (public.current_role() = 'floor_manager');

-- floor managers have no update policy: status changes go through this, so
-- they can't rename a machine
create or replace function public.set_machine_status(p_machine_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() not in ('admin','floor_manager') then
    raise exception 'Not allowed to change machine status';
  end if;

  update public.machines set status = p_status where id = p_machine_id;
  if not found then raise exception 'Machine not found'; end if;
end;
$$;

grant select, insert, update, delete on public.machines to authenticated;
grant execute on function public.set_machine_status(uuid,text) to authenticated;

notify pgrst, 'reload schema';
