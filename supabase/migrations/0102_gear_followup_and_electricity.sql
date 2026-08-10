-- Follow-up question and electricity flag on gear items,
-- plus per-line follow-up answer captured at cart-add time.
--
-- gear_items.follow_up_question: optional prompt shown in the public
--   item modal. When present, the user MUST answer before the item can
--   be added to the cart.
-- gear_items.requires_electricity: when true, the reserve page shows a
--   warning if the cart doesn't also include a battery/generator item.
-- gear_reservation_lines.follow_up_answer: the answer captured at cart
--   time; snapshotted here so future edits to the question don't affect
--   past reservations.

alter table public.gear_items
  add column if not exists follow_up_question text,
  add column if not exists requires_electricity boolean not null default false;

alter table public.gear_reservation_lines
  add column if not exists follow_up_answer text;

comment on column public.gear_items.follow_up_question is
  'Optional question asked when this item is added to a cart. If null/empty, no question is shown.';
comment on column public.gear_items.requires_electricity is
  'When true, the reserve page shows a warning if the request does not include a battery generator item.';
comment on column public.gear_reservation_lines.follow_up_answer is
  'Answer captured from gear_items.follow_up_question at the time the item was added to the cart.';
