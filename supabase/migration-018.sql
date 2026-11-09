-- ============================================================================
-- SNI Order System — migration 018: floor managers cannot cancel orders
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
-- ============================================================================

create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if public.current_role() is null or public.current_role() not in ('sales','factory','admin') then
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

notify pgrst, 'reload schema';
