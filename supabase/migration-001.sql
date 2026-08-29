-- ============================================================================
-- SNI Order System — migration 001
-- Run this ONCE on a database created before multi-item orders existed.
-- Safe to re-run (idempotent). A fresh project set up from schema.sql does
-- not need this.
--
-- Adds: several items in one submission share a single order number; each
-- item is its own row (line_no / line_count) so the floor can start /
-- complete / dispatch items independently.
-- ============================================================================

alter table public.orders add column if not exists line_no integer not null default 1;
alter table public.orders add column if not exists line_count integer not null default 1;
alter table public.orders drop constraint if exists orders_order_no_key;
create unique index if not exists orders_order_no_line_idx on public.orders(order_no, line_no);
create index if not exists orders_order_no_idx on public.orders(order_no);

-- NOTE: migration 002 supersedes the original place_order_multi() with a new
-- signature. If you are applying both migrations now, just run 002 — it
-- creates the current version of the function.
