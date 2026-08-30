-- ============================================================================
-- SNI Order System — migration 003
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Brings a database that is still on the ORIGINAL schema (multi-item orders,
-- global order numbering, no salesperson list, no cancellation) up to the
-- current app. It rolls up migration 001 + migration 002 and is safe whether
-- or not either of those was ever applied.
--
-- Fixes the two errors seen in the app:
--   * "Could not find the function public.place_order_multi(... p_placed_by ...)"
--   * Manage lists → Salespeople: check-constraint violation on insert
-- ============================================================================

-- ---- 1. orders: columns added over time ---------------------------------------

alter table public.orders add column if not exists line_no      integer     not null default 1;
alter table public.orders add column if not exists line_count   integer     not null default 1;
alter table public.orders add column if not exists placed_by    text;
alter table public.orders add column if not exists cancel_reason text;
alter table public.orders add column if not exists cancelled_at timestamptz;

-- one order_no can now hold several item rows (line_no / line_count)
alter table public.orders drop constraint if exists orders_order_no_key;
create index        if not exists orders_order_no_idx       on public.orders(order_no);
create unique index if not exists orders_order_no_line_idx  on public.orders(order_no, line_no);

-- allow the 'cancelled' status
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add  constraint orders_status_check
  check (status in ('pending','in_progress','completed','dispatched','cancelled'));

-- ---- 2. per-financial-year order counter ------------------------------------

create table if not exists public.order_counters (
  fy text primary key,
  last_serial integer not null default 0
);
alter table public.order_counters enable row level security;
-- no policies: only the security-definer RPC touches this table

-- continue numbering within any financial year that already has orders
-- (only matches the current 'SNI / YY-YY / NNN' format; old-format numbers
-- are left alone)
insert into public.order_counters (fy, last_serial)
  select split_part(order_no, ' / ', 2), max(serial_num)
  from public.orders
  where order_no ~ '^SNI / [0-9]{2}-[0-9]{2} / '
  group by split_part(order_no, ' / ', 2)
on conflict (fy) do update
  set last_serial = greatest(order_counters.last_serial, excluded.last_serial);

-- ---- 3. option_lists: allow list_type = 'salesperson' ----------------------

alter table public.option_lists drop constraint if exists option_lists_list_type_check;
alter table public.option_lists add  constraint option_lists_list_type_check
  check (list_type in ('thick','panel','party','salesperson'));

alter table public.option_lists enable row level security;

drop policy if exists "lists: any signed-in user can read" on public.option_lists;
create policy "lists: any signed-in user can read" on public.option_lists
  for select using (auth.role() = 'authenticated');

drop policy if exists "lists: admin manages all" on public.option_lists;
create policy "lists: admin manages all" on public.option_lists
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "lists: sales can add party" on public.option_lists;
create policy "lists: sales can add party" on public.option_lists
  for insert with check (list_type = 'party' and public.is_sales_or_admin());

-- ---- 4. drop the superseded order functions / sequence ---------------------

drop function if exists public.place_order(text,text,text,numeric,numeric,integer,text,date,integer,text,text[]);
drop function if exists public.place_order_multi(text,date,integer,text,text[],jsonb);
drop sequence if exists public.order_serial_seq;

-- ---- 5. current place_order_multi (adds p_placed_by + per-FY numbering) -----

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

-- ---- 6. cancel_order (floor queue cancellation) ----------------------------

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

-- ---- 7. grants --------------------------------------------------------------

grant select, insert on public.option_lists to authenticated;
grant execute on function public.place_order_multi(text,text,date,integer,text,text[],jsonb) to authenticated;
grant execute on function public.cancel_order(uuid,text) to authenticated;

-- ---- 8. reload PostgREST's schema cache ------------------------------------
-- (this is what clears the "Could not find the function ... in the schema
--  cache" error without waiting for the automatic reload)

notify pgrst, 'reload schema';

-- ---- 9. seed the salespeople ("order placed by") dropdown ----------------
-- Just names for the New Order form — NOT login accounts.

insert into public.option_lists (list_type, value) values
  ('salesperson', 'Ankit'),
  ('salesperson', 'Kunal'),
  ('salesperson', 'Mayank'),
  ('salesperson', 'Abhishek'),
  ('salesperson', 'Pradeesh')
on conflict (list_type, value) do nothing;

-- ---- 10. diagnostics --------------------------------------------------------

-- (a) the new function must be present
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'place_order_multi';

-- (b) option_lists constraint must list 'salesperson'
select pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.option_lists'::regclass and contype = 'c';

-- (c) your app account must be role = 'admin' to manage lists
select email, role from public.profiles order by role, email;

-- Done. Hard-reload the app and place a test order.
