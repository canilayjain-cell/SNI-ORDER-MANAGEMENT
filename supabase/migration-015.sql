-- ============================================================================
-- SNI Order System — migration 015: admin edit covers every order form field
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Adds party, salesperson, reminder and reference photos. The new parameters
-- are optional, so the app build that predates this migration keeps working.
-- ============================================================================

drop function if exists public.admin_edit_order_item(uuid,uuid,text,text,text,text,numeric,numeric,integer,text,date,text);

create or replace function public.admin_edit_order_item(
  p_order_id uuid, p_assigned_to uuid, p_thick text, p_panel text, p_door_type text, p_design_number text,
  p_length numeric, p_breadth numeric, p_qty integer, p_design text, p_delivery date, p_notes text,
  p_party text default null, p_placed_by text default null, p_reminder_days integer default null, p_photo_urls text[] default null
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_old public.orders;
  v_order public.orders;
  v_design_number text := nullif(btrim(p_design_number), '');
  v_design_photo text;
  v_assigned_name text;
  v_area numeric;
  v_party text := nullif(btrim(p_party), '');
  v_placed_by text := nullif(btrim(p_placed_by), '');
  v_reminder_days integer;
begin
  if public.is_admin() is not true then
    raise exception 'Only admin accounts can edit orders';
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if v_old.id is null or v_old.status not in ('pending','in_progress') then
    raise exception 'Order not found, or it is no longer in the floor queue';
  end if;

  if nullif(btrim(p_thick), '') is null or nullif(btrim(p_panel), '') is null then
    raise exception 'Thickness and panel are required';
  end if;
  if coalesce(p_length, 0) <= 0 or coalesce(p_breadth, 0) <= 0 or coalesce(p_qty, 0) <= 0 then
    raise exception 'Length, breadth and quantity must be greater than zero';
  end if;
  if p_delivery is null then
    raise exception 'Delivery date is required';
  end if;

  if p_assigned_to is not null then
    select coalesce(nullif(btrim(full_name), ''), email) into v_assigned_name
      from public.profiles where id = p_assigned_to and role = 'floor_manager';
    if v_assigned_name is null then
      raise exception 'The selected floor manager was not found';
    end if;
  end if;

  -- keep the photo copied at placement unless the design actually changed
  v_design_photo := v_old.design_photo_url;
  if v_design_number is distinct from v_old.design_number then
    select photo_url into v_design_photo from public.option_lists
      where list_type = 'design_number' and value = v_design_number;
  end if;

  v_reminder_days := coalesce(p_reminder_days, v_old.reminder_days);
  if v_reminder_days < 0 then
    raise exception 'Reminder days cannot be negative';
  end if;

  v_area := (p_length * p_breadth) / 92903.0;

  update public.orders set
    assigned_to = p_assigned_to,
    assigned_to_name = v_assigned_name,
    thick = btrim(p_thick),
    panel = btrim(p_panel),
    door_type = nullif(btrim(p_door_type), ''),
    design_number = v_design_number,
    design_photo_url = v_design_photo,
    length_mm = p_length,
    breadth_mm = p_breadth,
    qty = p_qty,
    area_sqft = v_area,
    total_sqft = v_area * p_qty,
    design = p_design,
    delivery_date = p_delivery,
    reminder_days = v_reminder_days,
    reminder_date = p_delivery - v_reminder_days,
    notes = nullif(btrim(p_notes), '')
  where id = p_order_id
  returning * into v_order;

  -- party and salesperson belong to the whole order, so every item changes
  if v_party is not null or v_placed_by is not null then
    update public.orders set
      party = coalesce(v_party, party),
      placed_by = coalesce(v_placed_by, placed_by)
    where order_no = v_old.order_no;

    select * into v_order from public.orders where id = p_order_id;
  end if;

  -- a party typed in here joins the list, as it does on New order
  if v_party is not null then
    insert into public.option_lists (list_type, value) values ('party', v_party)
      on conflict (list_type, value) do nothing;
  end if;

  if p_photo_urls is not null then
    delete from public.order_photos where order_id = p_order_id;
    insert into public.order_photos (order_id, url) select p_order_id, unnest(p_photo_urls);
  end if;

  return v_order;
end;
$$;

grant execute on function public.admin_edit_order_item(uuid,uuid,text,text,text,text,numeric,numeric,integer,text,date,text,text,text,integer,text[]) to authenticated;

notify pgrst, 'reload schema';
