-- ============================================================================
-- SNI Order System — migration 003
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Safe to re-run (fully idempotent).
--
-- Purpose: fix "Manage lists → Salespeople (order placed by)" failing to add
-- an item. The root cause is a database that never received the salesperson
-- parts of migration 002, so `option_lists.list_type` still rejects the value
-- 'salesperson' with a check-constraint violation.
--
-- This migration re-asserts only the pieces needed for that list to work, so
-- it is safe even if migration 002 was applied and even if it was not.
-- ============================================================================

-- ---- 1. allow list_type = 'salesperson' -----------------------------------

alter table public.option_lists
  drop constraint if exists option_lists_list_type_check;

alter table public.option_lists
  add constraint option_lists_list_type_check
  check (list_type in ('thick', 'panel', 'party', 'salesperson'));

-- ---- 2. re-assert the row-level-security policies for the table -----------
-- (no-ops if they already exist with the same definition)

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

-- ---- 3. column used by the "order placed by" dropdown --------------------

alter table public.orders add column if not exists placed_by text;

-- ---- 4. seed the salespeople ("order placed by") dropdown ----------------
-- These are just names shown in the New Order form's "Order placed by"
-- dropdown. They are NOT login accounts and have no user id / password.
-- Logins are still managed in Supabase (Authentication > Add user).

insert into public.option_lists (list_type, value) values
  ('salesperson', 'Ankit'),
  ('salesperson', 'Kunal'),
  ('salesperson', 'Mayank'),
  ('salesperson', 'Abhishek'),
  ('salesperson', 'Pradeesh')
on conflict (list_type, value) do nothing;

-- ---- 5. diagnostics -----------------------------------------------------------
-- After running, check the output of these two SELECTs.

-- (a) the constraint must now list 'salesperson'
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.option_lists'::regclass
  and contype = 'c';

-- (b) the account you are signed in as in the app must have role = 'admin'
--     (replace the email with the one shown top-right in the app)
select email, role from public.profiles order by role, email;

-- Done. Reload the app and try adding a salesperson again.
