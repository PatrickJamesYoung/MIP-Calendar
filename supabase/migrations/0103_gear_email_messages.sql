-- 0103_gear_email_messages.sql
--
-- Persistent log of every email sent from — and eventually received in —
-- the gear library workflow. This is the source of truth for the
-- Activity → Emails subsection on /admin/gear/[human_id], and the
-- table that inbound-reply polling (PR C) will insert into.
--
-- Design notes:
--   - `reservation_id` is nullable so future non-reservation emails
--     (e.g. one-off outreach) can share this log. Today every row is
--     tied to a reservation.
--   - `direction` uses a text CHECK rather than an enum because we
--     might add 'draft' or 'bounce' later without needing an enum
--     migration.
--   - `gmail_message_id` and `gmail_thread_id` are Gmail's own IDs.
--     They stay null when we sent via the fallback Resend transport.
--   - `body_text` is the source of truth we composed; `body_html` is
--     the rendered version we actually put on the wire. We store both
--     so admins can read a plaintext-safe copy in the UI without
--     rendering arbitrary HTML in the browser.
--   - No RLS: this table is server-only, accessed through the service-
--     role admin client, mirroring gear_activity.

create table if not exists public.gear_email_messages (
  id                uuid primary key default gen_random_uuid(),
  reservation_id    uuid references public.gear_reservations(id) on delete cascade,
  direction         text not null check (direction in ('outbound', 'inbound')),
  transport         text not null check (transport in ('gmail', 'resend')),
  gmail_message_id  text,
  gmail_thread_id   text,
  in_reply_to       text,
  from_address      text not null,
  to_address        text not null,
  cc_address        text,
  reply_to          text,
  subject           text not null,
  body_text         text not null default '',
  body_html         text,
  template_key      text,
  actor_email       text,
  sent_at           timestamptz,
  received_at       timestamptz,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists gear_email_messages_reservation_created_idx
  on public.gear_email_messages (reservation_id, created_at desc);

create index if not exists gear_email_messages_thread_idx
  on public.gear_email_messages (gmail_thread_id)
  where gmail_thread_id is not null;

-- Enforce Gmail-thread uniqueness only on outbound sends. Inbound
-- replies share a thread with the original outbound message but have
-- their own Gmail message IDs, so unique(gmail_message_id) is the
-- right constraint — but only when we actually have one.
create unique index if not exists gear_email_messages_gmail_message_id_uidx
  on public.gear_email_messages (gmail_message_id)
  where gmail_message_id is not null;

comment on table public.gear_email_messages is
  'All email sent or received for a gear reservation. Populated by the admin send flow and by inbound Gmail polling.';
