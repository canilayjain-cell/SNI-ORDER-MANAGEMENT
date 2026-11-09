-- ============================================================================
-- SNI Order System — migration 019: undo a mistaken start or complete
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run.
--
-- Moves an item one step back: In Progress to Pending, Completed to In
-- Progress. Allowed for whoever may work the item. Dispatched items stay put.
-- ============================================================================

create or replace function public.undo_order_step(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_order public.orders;
begin
  if public.can_work_order(p_order_id) is not true then
    raise exception 'Not allowed to change this order';
  end if;

  update public.orders set
    status = case status when 'in_progress' then 'pending' else 'in_progress' end,
    in_progress_at = case when status = 'in_progress' then null else in_progress_at end,
    completed_at = null
  where id = p_order_id and status in ('in_progress','completed')
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Order not found, or this step can no longer be undone';
  end if;

  insert into public.order_history (order_id, status, changed_by) values (p_order_id, v_order.status, auth.uid());
  return v_order;
end;
$$;

grant execute on function public.undo_order_step(uuid) to authenticated;

notify pgrst, 'reload schema';
