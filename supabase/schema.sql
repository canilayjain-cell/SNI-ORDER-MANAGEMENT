-- ============================================================================
-- SNI Order System — Supabase schema
-- Run this ONCE in your Supabase project: Project > SQL Editor > New query
-- Paste this whole file in and click "Run".
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. PROFILES  (one row per login, holds the role)
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'sales' check (role in ('admin','factory','sales')),
  created_at timestamptz not null default now()
);

-- auto-create a profile (default role: sales — least privilege) whenever
-- a new login is created, whether via self sign-in or admin invite
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helper functions used throughout the RLS policies and RPCs below
create or replace function public.current_role()
returns text language sql security definer set search_path = public stable
as $$ select role from public.profiles where id = auth.uid(); $$;

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable
as $$ select public.current_role() = 'admin'; $$;

create or replace function public.is_factory_or_admin()
returns boolean language sql security definer set search_path = public stable
as $$ select public.current_role() in ('factory','admin'); $$;

create or replace function public.is_sales_or_admin()
returns boolean language sql security definer set search_path = public stable
as $$ select public.current_role() in ('sales','admin'); $$;

alter table public.profiles enable row level security;

create policy "profiles: read own row" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: admin reads all" on public.profiles
  for select using (public.is_admin());

create policy "profiles: admin updates role" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
-- 2. OPTION LISTS  (thickness / panel / party dropdowns)
-- ============================================================================

create table public.option_lists (
  id uuid primary key default gen_random_uuid(),
  list_type text not null check (list_type in ('thick','panel','party')),
  value text not null,
  created_at timestamptz not null default now(),
  unique (list_type, value)
);

alter table public.option_lists enable row level security;

create policy "lists: any signed-in user can read" on public.option_lists
  for select using (auth.role() = 'authenticated');

create policy "lists: admin manages all" on public.option_lists
  for all using (public.is_admin()) with check (public.is_admin());

-- sales can add a new party inline while placing an order (matches the
-- original "+ Add new party" control) — thickness/panel stay admin-managed
create policy "lists: sales can add party" on public.option_lists
  for insert with check (list_type = 'party' and public.is_sales_or_admin());

-- ============================================================================
-- 3. ORDERS
-- ============================================================================

create sequence public.order_serial_seq start 1;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  serial_num integer not null,
  party text not null,
  thick text not null,
  panel text not null,
  length_mm numeric not null,
  breadth_mm numeric not null,
  qty integer not null default 1,
  area_sqft numeric not null,
  total_sqft numeric not null,
  design text not null default '2D' check (design in ('2D','3D')),
  delivery_date date not null,
  reminder_days integer not null default 2,
  reminder_date date,
  notes text,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','dispatched')),
  sequence integer not null default 0,
  dispatch_photo_url text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  in_progress_at timestamptz,
  completed_at timestamptz,
  dispatched_at timestamptz
);

create index orders_status_idx on public.orders(status);
create index orders_created_at_idx on public.orders(created_at desc);

create table public.order_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

create table public.order_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id)
);

alter table public.orders enable row level security;
alter table public.order_photos enable row level security;
alter table public.order_history enable row level security;

-- ---- SELECT policies: this is where the 3 roles actually diverge ----

create policy "orders: admin reads all" on public.orders
  for select using (public.is_admin());

create policy "orders: factory reads all" on public.orders
  for select using (public.current_role() = 'factory');

-- sales sees everything EXCEPT dispatched (closed/archived) orders —
-- this is the "no access to old completed orders" rule
create policy "orders: sales reads active only" on public.orders
  for select using (public.current_role() = 'sales' and status <> 'dispatched');

create policy "order_photos: readable if parent order readable" on public.order_photos
  for select using (exists (select 1 from public.orders o where o.id = order_photos.order_id));

create policy "order_history: readable if parent order readable" on public.order_history
  for select using (exists (select 1 from public.orders o where o.id = order_history.order_id));

-- ---- Writes: deliberately NOT opened up broadly. All routine mutations
-- (placing an order, starting it, completing it, dispatching it, re-ordering
-- the queue) go through the security-definer functions below, which check
-- the role explicitly and keep status/timestamps/history consistent.
-- Admin keeps a direct escape hatch for manual corrections.

create policy "orders: admin inserts" on public.orders
  for insert with check (public.is_admin());

create policy "orders: admin updates" on public.orders
  for update using (public.is_admin()) with check (public.is_admin());

create policy "order_photos: admin inserts" on public.order_photos
  for insert with check (public.is_admin());

-- ============================================================================
-- 4. RPC FUNCTIONS — the actual workflow actions, role-checked server-side
-- ============================================================================

-- place a new order (sales or admin)
create or replace function public.place_order(
  p_party text, p_thick text, p_panel text,
  p_length numeric, p_breadth numeric, p_qty integer,
  p_design text, p_delivery date, p_reminder_days integer,
  p_notes text, p_photo_urls text[]
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare
  v_serial integer;
  v_fy text;
  v_order_no text;
  v_area numeric;
  v_total numeric;
  v_seq integer;
  v_order public.orders;
  v_photo text;
  v_month integer := extract(month from now())::int;
  v_year integer := extract(year from now())::int;
  v_fy_start integer;
begin
  if public.current_role() not in ('sales','admin') then
    raise exception 'Only sales or admin accounts can place orders';
  end if;

  v_fy_start := case when v_month >= 4 then v_year else v_year - 1 end;
  v_fy := lpad((v_fy_start % 100)::text, 2, '0') || '-' || lpad(((v_fy_start + 1) % 100)::text, 2, '0');

  v_serial := nextval('public.order_serial_seq');
  v_order_no := 'SNI / ' || v_fy || ' / ' || lpad(v_serial::text, 3, '0');

  v_area := (p_length * p_breadth) / 92903.0;
  v_total := v_area * p_qty;

  select coalesce(max(sequence), 0) + 1 into v_seq
    from public.orders where status in ('pending','in_progress');

  insert into public.orders (
    order_no, serial_num, party, thick, panel, length_mm, breadth_mm, qty,
    area_sqft, total_sqft, design, delivery_date, reminder_days, reminder_date,
    notes, status, sequence, created_by
  ) values (
    v_order_no, v_serial, p_party, p_thick, p_panel, p_length, p_breadth, p_qty,
    v_area, v_total, p_design, p_delivery, p_reminder_days, p_delivery - p_reminder_days,
    p_notes, 'pending', v_seq, auth.uid()
  ) returning * into v_order;

  insert into public.order_history (order_id, status, changed_by) values (v_order.id, 'pending', auth.uid());

  if p_photo_urls is not null then
    foreach v_photo in array p_photo_urls loop
      insert into public.order_photos (order_id, url) values (v_order.id, v_photo);
    end loop;
  end if;

  return v_order;
end;
$$;

-- floor: start an order (pending -> in_progress)
create or replace function public.start_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if public.current_role() not in ('factory','admin') then
    raise exception 'Only factory or admin accounts can start an order';
  end if;

  update public.orders set status = 'in_progress', in_progress_at = now()
    where id = p_order_id and status = 'pending'
    returning * into v_order;

  if v_order.id is null then raise exception 'Order not found or not Pending'; end if;

  insert into public.order_history (order_id, status, changed_by) values (p_order_id, 'in_progress', auth.uid());
  return v_order;
end;
$$;

-- floor: complete an order (in_progress -> completed)
create or replace function public.complete_order(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if public.current_role() not in ('factory','admin') then
    raise exception 'Only factory or admin accounts can complete an order';
  end if;

  update public.orders set status = 'completed', completed_at = now()
    where id = p_order_id and status = 'in_progress'
    returning * into v_order;

  if v_order.id is null then raise exception 'Order not found or not In Progress'; end if;

  insert into public.order_history (order_id, status, changed_by) values (p_order_id, 'completed', auth.uid());
  return v_order;
end;
$$;

-- dispatch: attach the proof-of-dispatch photo URL (upload happens client-side to Storage first)
create or replace function public.set_dispatch_photo(p_order_id uuid, p_photo_url text)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if public.current_role() not in ('factory','admin') then
    raise exception 'Only factory or admin accounts can attach a dispatch photo';
  end if;

  update public.orders set dispatch_photo_url = p_photo_url
    where id = p_order_id and status = 'completed'
    returning * into v_order;

  if v_order.id is null then raise exception 'Order not found or not ready for dispatch'; end if;
  return v_order;
end;
$$;

-- dispatch: confirm dispatch (completed -> dispatched), requires a photo already attached
create or replace function public.confirm_dispatch(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if public.current_role() not in ('factory','admin') then
    raise exception 'Only factory or admin accounts can confirm dispatch';
  end if;

  update public.orders set status = 'dispatched', dispatched_at = now()
    where id = p_order_id and status = 'completed' and dispatch_photo_url is not null
    returning * into v_order;

  if v_order.id is null then raise exception 'Order not found, not completed, or missing a dispatch photo'; end if;

  insert into public.order_history (order_id, status, changed_by) values (p_order_id, 'dispatched', auth.uid());
  return v_order;
end;
$$;

-- floor: move an order up/down the fulfilment queue
create or replace function public.resequence_order(p_order_id uuid, p_direction text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_a public.orders;
  v_b public.orders;
begin
  if public.current_role() not in ('factory','admin') then
    raise exception 'Only factory or admin accounts can reorder the queue';
  end if;

  select * into v_a from public.orders where id = p_order_id;
  if v_a.id is null or v_a.status not in ('pending','in_progress') then
    raise exception 'Order not found or not in the active queue';
  end if;

  if p_direction = 'up' then
    select * into v_b from public.orders
      where status in ('pending','in_progress') and sequence < v_a.sequence
      order by sequence desc limit 1;
  else
    select * into v_b from public.orders
      where status in ('pending','in_progress') and sequence > v_a.sequence
      order by sequence asc limit 1;
  end if;

  if v_b.id is null then return; end if; -- already at the edge of the queue

  update public.orders set sequence = v_b.sequence where id = v_a.id;
  update public.orders set sequence = v_a.sequence where id = v_b.id;
end;
$$;

-- ============================================================================
-- 5. STORAGE  (reference photos + dispatch photos)
-- ============================================================================

insert into storage.buckets (id, name, public) values ('reference-photos','reference-photos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('dispatch-photos','dispatch-photos', true)
  on conflict (id) do nothing;

-- Buckets are public-read for simplicity (anyone with the exact file URL can view
-- it, but URLs are random/unguessable and never listed publicly) — only signed-in
-- sales/admin can upload reference photos, only factory/admin can upload dispatch
-- photos. If you later want stricter access (private + expiring signed URLs),
-- that's a follow-up change, not something to solve on day one.

create policy "reference-photos: sales/admin upload" on storage.objects
  for insert with check (bucket_id = 'reference-photos' and public.is_sales_or_admin());

create policy "dispatch-photos: factory/admin upload" on storage.objects
  for insert with check (bucket_id = 'dispatch-photos' and public.is_factory_or_admin());

-- ============================================================================
-- 6. REALTIME  (so all 3 dashboards update live, no manual refresh needed)
-- ============================================================================

alter publication supabase_realtime add table public.orders;

-- ============================================================================
-- 7. GRANTS
-- ============================================================================

grant usage on schema public to authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert on public.option_lists to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert on public.order_photos to authenticated;
grant select on public.order_history to authenticated;

grant execute on function public.current_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_factory_or_admin() to authenticated;
grant execute on function public.is_sales_or_admin() to authenticated;
grant execute on function public.place_order(text,text,text,numeric,numeric,integer,text,date,integer,text,text[]) to authenticated;
grant execute on function public.start_order(uuid) to authenticated;
grant execute on function public.complete_order(uuid) to authenticated;
grant execute on function public.set_dispatch_photo(uuid,text) to authenticated;
grant execute on function public.confirm_dispatch(uuid) to authenticated;
grant execute on function public.resequence_order(uuid,text) to authenticated;

-- ============================================================================
-- Done. Next: create your first login (Authentication > Add user in the
-- Supabase dashboard), then run this once, filling in that email, to make
-- them an admin:
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
--
-- See SETUP-GUIDE.md for the full walkthrough.
-- ============================================================================
