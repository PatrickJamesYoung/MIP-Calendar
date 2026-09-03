-- ============================================================
-- 0106_spaces_org_tier_and_staffing.sql
--
-- Three additions to the spaces module:
--   1. Sliding-scale org_tier prompt on the public reserve form
--      (mirrors gear's tier vocabulary + settings-driven multipliers).
--      The `spaces_reservations.org_tier` column already exists from
--      0104_spaces_schema.sql; this migration seeds the label and
--      multiplier settings that make the tier UI functional.
--   2. `spaces_reservations.staffing_organizer` — admin-only free-text
--      field for which MIP organizer is staffing the event.
--   3. `spaces_reservations.equipment_requested` — text[] of equipment
--      the requester is hoping to use in a space that has an equipment
--      follow-up configured (e.g. the art & production room).
--      Which space triggers the follow-up and which options appear
--      are both driven by spaces_settings so admins can adjust without
--      code changes.
-- ============================================================

-- ---------- Columns ----------

alter table public.spaces_reservations
  add column if not exists staffing_organizer text,
  add column if not exists equipment_requested text[];

-- ---------- Settings seeds ----------

insert into public.spaces_settings (key, value, notes) values
  ('tier_full_label',
   to_jsonb('Well-resourced organization'::text),
   'Label for the top tier on the reserve form. Applies tier_full_multiplier to the suggested donation.'),
  ('tier_mid_label',
   to_jsonb('Small organization or coalition'::text),
   'Label for the middle tier on the reserve form. Applies tier_mid_multiplier.'),
  ('tier_low_label',
   to_jsonb('Volunteer group or individual'::text),
   'Label for the low tier on the reserve form. Applies tier_low_multiplier.'),
  ('tier_full_multiplier',
   to_jsonb(1),
   'Multiplier applied to the full-rate subtotal for the full tier. Usually 1.'),
  ('tier_mid_multiplier',
   to_jsonb(0.85),
   'Multiplier applied to the full-rate subtotal for the middle tier.'),
  ('tier_low_multiplier',
   to_jsonb(0.65),
   'Multiplier applied to the full-rate subtotal for the low tier.'),
  ('art_production_slug',
   to_jsonb('art-and-production-room'::text),
   'Slug of the space that triggers the equipment follow-up question on the reserve form. Set empty to disable.'),
  ('art_production_equipment',
   to_jsonb(array['Cricut', 'Button maker', 'Color printer', 'Projector', 'Sewing machine', 'Paint brushes']),
   'Equipment checkboxes shown when the configured space is in the selection. JSON array of strings.')
on conflict (key) do nothing;
