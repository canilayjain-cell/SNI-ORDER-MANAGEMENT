-- ============================================================================
-- SNI Order System — migration 010: door type names, Custom Mica Door
-- Run this ONCE in Supabase: Project > SQL Editor > New query > paste > Run.
-- Fully idempotent — safe to re-run. Data only, no schema change.
--
-- Renames ten door types everywhere they are stored, so design numbers stay
-- linked, and adds Custom Mica Door (no design numbers; photo per order).
-- ============================================================================

with names(old_name, new_name) as (values
  ('Mica Doors',          'Mica Door'),
  ('Digital Mica Doors',  'Digital Mica Door'),
  ('Golden Patti Doors',  'Mica Golden Patti Door'),
  ('Brass Doors',         'Mica Brass Door'),
  ('Embossed Doors',      'Embossed Brass Mica Door'),
  ('Mirror Doors',        'Mirror Door'),
  ('Membrane Doors',      'Membrane Door'),
  ('Steel Beading Doors', 'Membrane Steel Beading Door'),
  ('Micro Coated Doors',  'Micro Coated Door'),
  ('UV-Membrane Doors',   'UV-Membrane Door')
), list_rows as (
  update public.option_lists o set value = n.new_name
    from names n where o.list_type = 'door_type' and o.value = n.old_name
    returning 1
), design_rows as (
  update public.option_lists o set door_type = n.new_name
    from names n where o.list_type = 'design_number' and o.door_type = n.old_name
    returning 1
)
update public.orders o set door_type = n.new_name
  from names n where o.door_type = n.old_name;

insert into public.option_lists (list_type, value) values ('door_type', 'Custom Mica Door')
  on conflict (list_type, value) do nothing;
