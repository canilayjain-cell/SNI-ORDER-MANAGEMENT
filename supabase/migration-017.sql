-- ============================================================================
-- SNI Order System — migration 017: reference photos and notes per item
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- The function signature is unchanged, so the app build that predates this
-- migration keeps placing orders.
-- ============================================================================

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
        from public.profiles where id = v_assigned_to and role = 'floor_manager';
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

notify pgrst, 'reload schema';
