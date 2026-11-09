-- ============================================================================
-- SNI Order System — migration 014: rename list entries safely
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Renaming a list entry also updates everything that stores that name: design
-- numbers linked to a door type, and existing orders. Door type rules move
-- onto the door type itself so they survive a rename.
-- ============================================================================

alter table public.option_lists add column if not exists default_panel text;
alter table public.option_lists add column if not exists photo_required boolean not null default false;

update public.option_lists set default_panel = 'Flush Door'
  where list_type = 'door_type' and default_panel is null and value in (
    'Mica Door', 'Digital Mica Door', 'Mica Golden Patti Door', 'Mica Brass Door', 'Embossed Mica Door', 'Mirror Door',
    'Membrane Door', 'Membrane Steel Beading Door', 'Micro Coated Door', 'UV-Membrane Door', 'Custom Mica Door'
  );

update public.option_lists set photo_required = true
  where list_type = 'door_type' and value = 'Custom Mica Door';

create or replace function public.rename_option(p_id uuid, p_value text)
returns public.option_lists
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.option_lists;
  v_old text;
  v_new text := nullif(btrim(p_value), '');
begin
  if public.is_admin() is not true then
    raise exception 'Only admin accounts can rename list items';
  end if;
  if v_new is null then
    raise exception 'The name cannot be empty';
  end if;

  select * into v_row from public.option_lists where id = p_id for update;
  if v_row.id is null then
    raise exception 'List item not found';
  end if;

  v_old := v_row.value;
  if v_old = v_new then
    return v_row;
  end if;

  update public.option_lists set value = v_new where id = p_id returning * into v_row;

  case v_row.list_type
    when 'door_type' then
      update public.option_lists set door_type = v_new where list_type = 'design_number' and door_type = v_old;
      update public.orders set door_type = v_new where door_type = v_old;
    when 'design_number' then
      update public.orders set design_number = v_new where design_number = v_old;
    when 'salesperson' then
      update public.orders set placed_by = v_new where placed_by = v_old;
    when 'party' then
      update public.orders set party = v_new where party = v_old;
    when 'thick' then
      update public.orders set thick = v_new where thick = v_old;
    when 'panel' then
      update public.orders set panel = v_new where panel = v_old;
      update public.option_lists set default_panel = v_new where list_type = 'door_type' and default_panel = v_old;
  end case;

  return v_row;
end;
$$;

grant execute on function public.rename_option(uuid,text) to authenticated;

notify pgrst, 'reload schema';
