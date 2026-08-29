# SNI Order System (Next.js + Supabase)

A factory order-routing app: sales place orders, factory floor works a
sequenced queue, dispatch closes orders out with a proof photo, and admins
get a live KPI worksheet. Three real logins (Admin / Factory / Sales), each
enforced by the Postgres database itself via row-level security — not just
hidden in the UI.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project (free tier is enough to start).
2. Wait for it to finish provisioning.

## 2. Run the database schema

1. In the Supabase dashboard, open **SQL Editor > New query**.
2. Paste in the entire contents of `supabase/schema.sql` and click **Run**.
   This creates all tables, the 3 roles, row-level security policies, the
   workflow functions (place/start/complete/dispatch/resequence), the two
   storage buckets, and turns on realtime for the `orders` table.

## 3. Turn off public sign-up (recommended)

Since accounts here are meant to be curated (Admin/Factory/Sales), not
open registration: in the dashboard go to **Authentication > Providers >
Email** and turn off "Allow new users to sign up". Admins will create
accounts manually instead (step 5).

## 4. Get your API keys

In the dashboard: **Project Settings > API**. You'll need:
- **Project URL**
- **anon public** key

## 5. Configure the app

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and paste in your Project URL and anon key:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

## 6. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll land on the
login screen.

## 7. Create your first login (and make it Admin)

1. In the Supabase dashboard: **Authentication > Users > Add user**. Give
   them an email + password (or send an invite email).
   A profile row is created for them automatically, defaulted to the
   **Sales** role.
2. Back in **SQL Editor**, run (with their real email):

   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```

3. Sign in with that account at `/login`. You'll see all 6 tabs, including
   **Manage users** — from there you can promote/demote any other account
   without touching SQL again.

## 8. Add the rest of your team

Repeat step 7.1 for each person (Authentication > Add user in the
dashboard), then go to **Manage users** in the app (as an admin) and set
their role: **Sales**, **Factory**, or leave/promote to **Admin**.

## Roles, exactly as enforced

| | Admin | Factory | Sales |
|---|---|---|---|
| New order | ✅ | ❌ | ✅ |
| Floor queue | ✅ full control | ✅ full control | 👁 view only |
| Dispatch | ✅ | ✅ | ❌ (no tab) |
| Worksheet | ✅ + KPIs/charts/export | ❌ (no tab) | 👁 view only, no export/print-bulk |
| Manage lists | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| Dispatched (closed) order history | ✅ sees everything | sees it (needed for their own recent-dispatch view) | ❌ hidden — Sales never sees rows once they reach Dispatched |

The table above is UX (tabs hide/show, buttons appear/disappear). The real
boundary is `supabase/schema.sql`: every table has row-level security, and
every state-changing action (start, complete, confirm dispatch, resequence,
place an order) runs through a Postgres function that checks the caller's
role itself. Editing the browser's JavaScript cannot bypass this.

## Architecture notes

- **Realtime**: all three dashboards subscribe to Postgres changes on the
  `orders` table, so a floor-queue update shows up on the sales worksheet
  within a second or two — no manual refresh needed (a 30s poll runs as a
  fallback in case the realtime socket drops).
- **Photos**: reference photos and dispatch photos are resized client-side
  (long edge capped, JPEG-compressed) before upload to two Supabase Storage
  buckets, `reference-photos` and `dispatch-photos`. Both are public-read
  buckets for simplicity — anyone with the exact (random, unguessable) file
  URL can view it, but nothing is publicly listed or browsable. Only
  sales/admin can upload to the first, only factory/admin to the second.
- **Order numbers**: assigned atomically inside `place_order_multi()` from a
  per-financial-year counter (`order_counters`), format `SNI / 26-27 / 001`.
  The financial year runs Apr–Mar, and the serial resets to `001` every
  April (2027-28 starts fresh). No race condition between two people saving
  at once. One submission gets one order number; if it has several items
  they share that number and each becomes its own row (`line_no` /
  `line_count`, shown as `… · item 2/3`) so the floor can start, complete
  and dispatch each item independently.
- **Order placed by**: every order records the salesperson who placed it,
  chosen from an admin-managed list (`option_lists`, type `salesperson`,
  edited under Manage lists).
- **Cancellation**: factory/sales/admin can cancel a `pending` /
  `in_progress` order from the floor queue via `cancel_order()`; a reason is
  mandatory and is stored on the order (`cancel_reason`) and in its history.
- **Schema upgrades**: `supabase/schema.sql` is the fresh-install schema.
  Existing databases apply `supabase/migration-001.sql` then
  `migration-002.sql` (both idempotent).
- **Middleware** (`middleware.ts`) refreshes the Supabase session on every
  request and redirects signed-out users to `/login`, and redirects a
  signed-in user away from any tab their role can't reach.

## Deploying

This is a standard Next.js app — [Vercel](https://vercel.com) is the path
of least resistance (connect the repo, add the two `NEXT_PUBLIC_SUPABASE_*`
env vars in the project settings, deploy). Any other Node host works too.

## Extending later

- Stricter photo privacy (private buckets + short-lived signed URLs instead
  of public-read).
- Password reset flow, and a "remember me" / longer session option.
- An audit view over `order_history` (already recorded on every status
  change — just not surfaced in the UI yet).
