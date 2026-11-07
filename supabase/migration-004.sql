-- ============================================================================
-- SNI Order System — migration 004: floor managers ("Order given to")
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Adds a 'floor_manager' role. Every new order is given to one floor manager
-- (a real login), and a floor manager can only see and work the orders
-- given to them. Factory and admin accounts still see everything.
--
-- place_order_multi gains p_assigned_to as an OPTIONAL last parameter, so an
-- app build that predates this migration keeps placing orders until the new
-- build is deployed.
-- ============================================================================

-- ---- 1. profiles: allow role = 'floor_manager' -------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add  constraint profiles_role_check
  check (role in ('admin','factory','sales','floor_manager'));

-- ---- 2. orders: who the order is given to ------------------------------------

alter table public.orders add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
-- the name is copied at placement time: sales/factory accounts cannot read
-- other people's profiles, but every screen needs to show it
alter table public.orders add column if not exists assigned_to_name text;
create index if not exists orders_assigned_to_idx on public.orders(assigned_to);

-- ---- 3. helpers --------------------------------------------------------------

-- may the signed-in user work (start / complete / cancel / dispatch) this order?
create or replace function public.can_work_order(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case public.current_role()
    when 'admin'         then true
    when 'factory'       then true
    when 'floor_manager' then exists (select 1 from public.orders where id = p_order_id and assigned_to = auth.uid())
    else false
  end;
$$;

-- the "Order given to" dropdown: sales accounts cannot read profiles directly
create or replace function public.list_floor_managers()
returns table (id uuid, name text)
language sql stable security definer set search_path = public
as $$
  select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email)
  from public.profiles p
  where p.role = 'floor_manager' and public.current_role() in ('sales','admin')
  order by 2;
$$;

-- ---- 4. orders: floor managers read only their own ---------------------------

drop policy if exists "orders: floor manager reads assigned" on public.orders;
create policy "orders: floor manager reads assigned" on public.orders
  for select using (public.current_role() = 'floor_manager' and assigned_to = auth.uid());

-- dispatch photos: floor managers upload too (set_dispatch_photo still checks
-- that the order is theirs)
drop policy if exists "dispatch-photos: factory/admin upload" on storage.objects;
drop policy if exists "dispatch-photos: factory/floor/admin upload" on storage.objects;
create policy "dispatch-photos: factory/floor/admin upload" on storage.objects
  for insert with check (
    bucket_id = 'dispatch-photos' and public.current_role() in ('factory','floor_manager','admin')
  );

-- ---- 5. place_order_multi: + p_assigned_to -----------------------------------

drop function if exists public.place_order_multi(text,text,date,integer,text,text[],jsonb);

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
      thick, panel, length_mm, breadth_mm, qty, area_sqft, total_sqft, design,
      delivery_date, reminder_days, reminder_date, notes, status, sequence, created_by
    ) values (
      v_order_no, v_idx, v_line_count, v_serial, p_party, nullif(btrim(p_placed_by), ''),
      p_assigned_to, v_assigned_name,
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

-- ---- 6. floor actions: floor managers may act on their own orders ------------

create or replace function public.start_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if not public.can_work_order(p_order_id) then
    raise exception 'Not allowed to start this order';
  end if;

  update public.orders set status = 'in_progress', in_progress_at = now()
    where id = p_order_id and status = 'pending'
    returning * into v_order;

  if v_order.id is null then raise exception 'Order not found or not Pending'; end if;

  insert into public.order_history (order_id, status, changed_by) values (p_order_id, 'in_progress', auth.uid());
  return v_order;
end;
$$;

create or replace function public.complete_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if not public.can_work_order(p_order_id) then
    raise exception 'Not allowed to complete this order';
  end if;

  update public.orders set status = 'completed', completed_at = now()
    where id = p_order_id and status = 'in_progress'
    returning * into v_order;

  if v_order.id is null then raise exception 'Order not found or not In Progress'; end if;

  insert into public.order_history (order_id, status, changed_by) values (p_order_id, 'completed', auth.uid());
  return v_order;
end;
$$;

create or replace function public.set_dispatch_photo(p_order_id uuid, p_photo_url text)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if not public.can_work_order(p_order_id) then
    raise exception 'Not allowed to attach a dispatch photo to this order';
  end if;

  update public.orders set dispatch_photo_url = p_photo_url
    where id = p_order_id and status = 'completed'
    returning * into v_order;

  if v_order.id is null then raise exception 'Order not found or not ready for dispatch'; end if;
  return v_order;
end;
$$;

create or replace function public.confirm_dispatch(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if not public.can_work_order(p_order_id) then
    raise exception 'Not allowed to confirm dispatch of this order';
  end if;

  update public.orders set status = 'dispatched', dispatched_at = now()
    where id = p_order_id and status = 'completed' and dispatch_photo_url is not null
    returning * into v_order;

  if v_order.id is null then raise exception 'Order not found, not completed, or missing a dispatch photo'; end if;

  insert into public.order_history (order_id, status, changed_by) values (p_order_id, 'dispatched', auth.uid());
  return v_order;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if not (public.current_role() = 'sales' or public.can_work_order(p_order_id)) then
    raise exception 'Not allowed to cancel this order';
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

-- a floor manager re-arranges only within their own orders: the swap partner
-- is the next of THEIR orders, not the next order in the whole queue
create or replace function public.resequence_order(p_order_id uuid, p_direction text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_a public.orders;
  v_b public.orders;
  v_mine_only boolean := public.current_role() = 'floor_manager';
begin
  if not public.can_work_order(p_order_id) then
    raise exception 'Not allowed to reorder this order';
  end if;

  select * into v_a from public.orders where id = p_order_id;
  if v_a.id is null or v_a.status not in ('pending','in_progress') then
    raise exception 'Order not found or not in the active queue';
  end if;

  if p_direction = 'up' then
    select * into v_b from public.orders
      where status in ('pending','in_progress') and sequence < v_a.sequence
        and (not v_mine_only or assigned_to = auth.uid())
      order by sequence desc limit 1;
  else
    select * into v_b from public.orders
      where status in ('pending','in_progress') and sequence > v_a.sequence
        and (not v_mine_only or assigned_to = auth.uid())
      order by sequence asc limit 1;
  end if;

  if v_b.id is null then return; end if; -- already at the edge of the queue

  update public.orders set sequence = v_b.sequence where id = v_a.id;
  update public.orders set sequence = v_a.sequence where id = v_b.id;
end;
$$;

-- ---- 7. grants ---------------------------------------------------------------

grant execute on function public.can_work_order(uuid) to authenticated;
grant execute on function public.list_floor_managers() to authenticated;
grant execute on function public.place_order_multi(text,text,date,integer,text,text[],jsonb,uuid) to authenticated;

notify pgrst, 'reload schema';
