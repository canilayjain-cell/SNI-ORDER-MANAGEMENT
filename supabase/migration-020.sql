-- ============================================================================
-- SNI Order System — migration 020: Factory accounts on the Machinery tab
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Same access as floor managers: see every machine and change its status.
-- Adding and removing machines stays admin only.
-- ============================================================================

drop policy if exists "machines: floor manager reads" on public.machines;
drop policy if exists "machines: floor manager and factory read" on public.machines;
create policy "machines: floor manager and factory read" on public.machines
  for select using (public.current_role() in ('floor_manager','factory'));

create or replace function public.set_machine_status(p_machine_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.current_role() is null or public.current_role() not in ('admin','floor_manager','factory') then
    raise exception 'Not allowed to change machine status';
  end if;

  update public.machines set status = p_status where id = p_machine_id;
  if not found then raise exception 'Machine not found'; end if;
end;
$$;

notify pgrst, 'reload schema';
