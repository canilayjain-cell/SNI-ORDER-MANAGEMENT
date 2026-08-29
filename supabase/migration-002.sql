-- ============================================================================
-- SNI Order System — migration 002
-- Run this ONCE on an existing database that already had migration 001
-- (line_no / line_count / place_order_multi).  Safe to re-run (idempotent).
--
-- Adds:
--   * per-financial-year order numbering (serial resets to 001 every April)
--   * "Order placed by" salesperson list + orders.placed_by
--   * order cancellation from the floor queue, with a mandatory reason
-- ============================================================================

-- ---- 1. per-financial-year order counter -----------------------------------

create table if not exists public.order_counters (
  fy text primary key,
  last_serial integer not null default 0
);
alter table public.order_counters enable row level security;

-- seed from orders already placed so numbering continues within each FY
insert into public.order_counters (fy, last_serial)
  select split_part(order_no, ' / ', 2), max(serial_num)
  from public.orders
  where order_no like 'SNI / %'
  group by split_part(order_no, ' / ', 2)
on conflict (fy) do update
  set last_serial = greatest(order_counters.last_serial, excluded.last_serial);

-- old global sequence + single-item function are no longer used
drop function if exists public.place_order(text,text,text,numeric,numeric,integer,text,date,integer,text,text[]);
drop function if exists public.place_order_multi(text,date,integer,text,text[],jsonb);
drop sequence if exists public.order_serial_seq;

-- ---- 2. salesperson list + orders.placed_by -------------------------------

alter table public.option_lists drop constraint if exists option_lists_list_type_check;
alter table public.option_lists add constraint option_lists_list_type_check
  check (list_type in ('thick','panel','party','salesperson'));

alter table public.orders add column if not exists placed_by text;

-- ---- 3. cancellation -----------------------------------------------------

alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending','in_progress','completed','dispatched','cancelled'));

-- ---- 4. functions ------------------------------------------------------------

create or replace function public.place_order_multi(
  p_party text, p_placed_by text, p_delivery date, p_reminder_days integer,
  p_notes text, p_photo_urls text[], p_items jsonb
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
begin
  if public.current_role() not in ('sales','admin') then
    raise exception 'Only sales or admin accounts can place orders';
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
      order_no, line_no, line_count, serial_num, party, placed_by, thick, panel,
      length_mm, breadth_mm, qty, area_sqft, total_sqft, design,
      delivery_date, reminder_days, reminder_date, notes, status, sequence, created_by
    ) values (
      v_order_no, v_idx, v_line_count, v_serial, p_party, nullif(btrim(p_placed_by), ''),
      v_item->>'thick', v_item->>'panel', v_length, v_breadth, v_qty,
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

create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if public.current_role() not in ('sales','factory','admin') then
    raise exception 'Not allowed to cancel orders';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A cancellation reason is required';
  end if;

  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason)
   where id = p_order_id and status in ('pending','in_progress')
   returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found, or it can no longer be cancelled at its current stage';
  end if;

  insert into public.order_history (order_id, status, changed_by) values (p_order_id, 'cancelled', auth.uid());
  return v_order;
end;
$$;

-- ---- 5. grants -------------------------------------------------------------

grant execute on function public.place_order_multi(text,text,date,integer,text,text[],jsonb) to authenticated;
grant execute on function public.cancel_order(uuid,text) to authenticated;

-- Done.
