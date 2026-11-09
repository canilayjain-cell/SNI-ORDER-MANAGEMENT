-- ============================================================================
-- SNI Order System — migration 005: door type + design number
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Adds two admin-managed lists and stores the chosen values on each order
-- item. Both are optional. The function signature is unchanged, so the app
-- build that predates this migration keeps placing orders.
-- ============================================================================

-- ---- 1. option_lists: allow the two new list types ---------------------------

alter table public.option_lists drop constraint if exists option_lists_list_type_check;
alter table public.option_lists add  constraint option_lists_list_type_check
  check (list_type in ('thick','panel','party','salesperson','door_type','design_number'));

-- ---- 2. orders: the chosen values --------------------------------------------

alter table public.orders add column if not exists door_type     text;
alter table public.orders add column if not exists design_number text;

-- ---- 3. place_order_multi: store them from each item -------------------------

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
begin
  if public.current_role() not in ('sales','admin') then
    raise exception 'Only sales or admin accounts can place orders';
  end if;

  if p_assigned_to is not null then
    select coalesce(nullif(btrim(full_name), ''), email) into v_assigned_name
      from public.profiles where id = p_assigned_to and role = 'floor_manager';
    if v_assigned_name is null then
      raise exception 'The selected floor manager was not found';
    end if;
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

    insert into public.orders (
      order_no, line_no, line_count, serial_num, party, placed_by, assigned_to, assigned_to_name,
      thick, panel, door_type, design_number, length_mm, breadth_mm, qty, area_sqft, total_sqft, design,
      delivery_date, reminder_days, reminder_date, notes, status, sequence, created_by
    ) values (
      v_order_no, v_idx, v_line_count, v_serial, p_party, nullif(btrim(p_placed_by), ''),
      p_assigned_to, v_assigned_name,
      v_item->>'thick', v_item->>'panel',
      nullif(btrim(v_item->>'door_type'), ''), nullif(btrim(v_item->>'design_number'), ''),
      v_length, v_breadth, v_qty,
      v_area, v_total, coalesce(v_item->>'design', '2D'),
      p_delivery, p_reminder_days, p_delivery - p_reminder_days,
      p_notes, 'pending', v_seq_base + v_idx, auth.uid()
    ) returning * into v_order;

    insert into public.order_history (order_id, status, changed_by)
      values (v_order.id, 'pending', auth.uid());

    if p_photo_urls is not null then
      foreach v_photo in array p_photo_urls loop
        insert into public.order_photos (order_id, url) values (v_order.id, v_photo);
      end loop;
    end if;

    return next v_order;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
