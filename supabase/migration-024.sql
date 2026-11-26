-- ============================================================================
-- SNI Order System — migration 024: monthly production dashboard and targets
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
-- ============================================================================

create table if not exists public.production_targets (
  panel text primary key,
  target_sqft numeric not null check (target_sqft > 0)
);

insert into public.production_targets (panel, target_sqft) values
  ('WPC DOOR', 15000),
  ('Flush Door', 30000),
  ('HDHMR', 10000)
on conflict (panel) do nothing;

alter table public.production_targets enable row level security;

drop policy if exists "production targets: authenticated read" on public.production_targets;
create policy "production targets: authenticated read" on public.production_targets
  for select using (auth.role() = 'authenticated');

drop policy if exists "production targets: admin update" on public.production_targets;
create policy "production targets: admin update" on public.production_targets
  for update using (public.is_admin()) with check (public.is_admin());

grant select, update on public.production_targets to authenticated;

create or replace function public.monthly_production_output()
returns table (production_month date, panel text, total_sqft numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_month_end timestamptz := v_month_start + interval '1 month';
begin
  if auth.uid() is null or coalesce(public.current_role(), '') not in ('admin', 'sales') then
    raise exception 'Not allowed to view monthly production output';
  end if;

  return query
  with production_panels(panel) as (
    values ('WPC DOOR'::text), ('Flush Door'::text), ('HDHMR'::text)
  ),
  panel_totals as (
    select
      case upper(btrim(o.panel))
        when 'WPC DOOR' then 'WPC DOOR'
        when 'FLUSH DOOR' then 'Flush Door'
        when 'HDHMR' then 'HDHMR'
      end as panel,
      sum(o.total_sqft)::numeric as total_sqft
    from public.orders o
    where o.status in ('completed', 'dispatched')
      and o.completed_at >= v_month_start
      and o.completed_at < v_month_end
      and upper(btrim(o.panel)) in ('WPC DOOR', 'FLUSH DOOR', 'HDHMR')
    group by 1
  )
  select
    (v_month_start at time zone 'Asia/Kolkata')::date,
    production_panels.panel,
    coalesce(panel_totals.total_sqft, 0)::numeric
  from production_panels
  left join panel_totals on panel_totals.panel = production_panels.panel
  order by case production_panels.panel
    when 'WPC DOOR' then 1
    when 'Flush Door' then 2
    else 3
  end;
end;
$$;

revoke all on function public.monthly_production_output() from public, anon;
grant execute on function public.monthly_production_output() to authenticated;

notify pgrst, 'reload schema';
