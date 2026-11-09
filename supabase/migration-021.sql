-- ============================================================================
-- SNI Order System — migration 021: items can be assigned to chosen accounts
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- profiles.assignable lets a login outside the floor_manager role appear in
-- "Assigned to". Turned on for Floor Manager 1, who is on the Factory role.
-- Also lets that login place orders, which the Factory role otherwise blocked.
-- ============================================================================

alter table public.profiles add column if not exists assignable boolean not null default false;

update public.profiles set assignable = true where email = 'floormanager1@sni.local';

-- the per-login New order grant now works for any role, not just floor managers
create or replace function public.can_place_orders()
returns boolean
language sql stable security definer set search_path = public
as $$
  select role in ('sales','admin') or can_place_orders
  from public.profiles where id = auth.uid();
$$;

create or replace function public.list_floor_managers()
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email)
  from public.profiles p
  where (p.role = 'floor_manager' or p.assignable) and public.can_place_orders()
  order by 2;
$$;

create or replace function public.place_order_multi(
  p_party text, p_placed_by text, p_delivery date, p_reminder_days integer,
  p_notes text, p_photo_urls text[], p_items jsonb, p_assigned_to uuid default null
)
returns setof public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_serial integer;
  v_fy text;
  v_order_no text;
  v_seq_base integer;
  v_line_count integer;
  v_idx integer := 0;
  v_item jsonb;
  v_length numeric;
  v_breadth numeric;
  v_qty integer;
  v_area numeric;
  v_total numeric;
  v_order public.orders;
  v_photo text;
  v_month integer := extract(month from now())::int;
  v_year integer := extract(year from now())::int;
  v_fy_start integer;
  v_assigned_name text;
  v_design_number text;
  v_design_photo text;
  v_assigned_to uuid;
  v_photos text[];
begin
  if public.can_place_orders() is not true then
    raise exception 'This account is not allowed to place orders';
  end if;

  v_line_count := jsonb_array_length(p_items);
  if v_line_count is null or v_line_count = 0 then
    raise exception 'An order needs at least one item';
  end if;

  v_fy_start := case when v_month >= 4 then v_year else v_year - 1 end;
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');

  insert into public.order_counters (fy, last_serial) values (v_fy, 1)
    on conflict (fy) do update set last_serial = order_counters.last_serial + 1
    returning last_serial into v_serial;
  v_order_no := 'SNI / ' || v_fy || ' / ' || lpad(v_serial::text, 3, '0');

  select coalesce(max(sequence), 0) into v_seq_base
    from public.orders where status in ('pending','in_progress');

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_idx := v_idx + 1;
    v_length  := (v_item->>'length')::numeric;
    v_breadth := (v_item->>'breadth')::numeric;
    v_qty     := coalesce((v_item->>'qty')::integer, 1);
    v_area  := (v_length * v_breadth) / 92903.0;
    v_total := v_area * v_qty;
    v_design_number := nullif(btrim(v_item->>'design_number'), '');

    -- photos and notes come per item; p_photo_urls and p_notes are what the
    -- app build that predates this migration sends
    v_photos := case when v_item ? 'photo_urls'
      then array(select jsonb_array_elements_text(v_item->'photo_urls'))
      else p_photo_urls end;

    -- each item can go to its own floor manager; p_assigned_to is what the
    -- app build that predates this migration sends
    v_assigned_to := coalesce(nullif(v_item->>'assigned_to', '')::uuid, p_assigned_to);
    v_assigned_name := null;
    if v_assigned_to is not null then
      select coalesce(nullif(btrim(full_name), ''), email) into v_assigned_name
        from public.profiles where id = v_assigned_to and (role = 'floor_manager' or assignable);
      if v_assigned_name is null then
        raise exception 'The selected floor manager was not found';
      end if;
    end if;

    -- copy the photo onto the order, so replacing a design's photo later
    -- doesn't change orders already placed
    select photo_url into v_design_photo from public.option_lists
      where list_type = 'design_number' and value = v_design_number;

    insert into public.orders (
      order_no, line_no, line_count, serial_num, party, placed_by, assigned_to, assigned_to_name,
      thick, panel, door_type, design_number, design_photo_url, length_mm, breadth_mm, qty, area_sqft, total_sqft, design,
      delivery_date, reminder_days, reminder_date, notes, status, sequence, created_by
    ) values (
      v_order_no, v_idx, v_line_count, v_serial, p_party, nullif(btrim(p_placed_by), ''),
      v_assigned_to, v_assigned_name,
      v_item->>'thick', v_item->>'panel',
      nullif(btrim(v_item->>'door_type'), ''), v_design_number, v_design_photo,
      v_length, v_breadth, v_qty,
      v_area, v_total, coalesce(v_item->>'design', '2D'),
      p_delivery, p_reminder_days, p_delivery - p_reminder_days,
      nullif(btrim(case when v_item ? 'notes' then v_item->>'notes' else p_notes end), ''), 'pending', v_seq_base + v_idx, auth.uid()
    ) returning * into v_order;

    insert into public.order_history (order_id, status, changed_by)
      values (v_order.id, 'pending', auth.uid());

    if v_photos is not null then
      foreach v_photo in array v_photos loop
        insert into public.order_photos (order_id, url) values (v_order.id, v_photo);
      end loop;
    end if;

    return next v_order;
  end loop;
end;
$$;

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
      from public.profiles where id = p_assigned_to and (role = 'floor_manager' or assignable);
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

notify pgrst, 'reload schema';
