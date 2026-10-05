-- Server-only accounting integration. No browser-role access, even for admins.
create table public.qbo_connection (
  id boolean primary key default true check (id),
  realm_id text not null,
  environment text not null check (environment in ('sandbox', 'production')),
  company_name text not null,
  tokens_encrypted text not null,
  access_expires_at timestamptz not null,
  enabled boolean not null default false,
  auto_send_disabled_confirmed boolean not null default false,
  gear_item_id text,
  spaces_item_id text,
  gear_tax_code text check (gear_tax_code in ('TAX', 'NON')),
  spaces_tax_code text check (spaces_tax_code in ('TAX', 'NON')),
  updated_at timestamptz not null default now()
);

create table public.qbo_oauth_states (
  state_hash text primary key,
  admin_id uuid not null references public.admins(id),
  expires_at timestamptz not null
);

create table public.qbo_locks (
  resource text primary key,
  owner uuid not null,
  expires_at timestamptz not null
);

create or replace function public.qbo_acquire_lock(p_resource text, p_owner uuid)
returns boolean language plpgsql security invoker set search_path = public as $$
declare acquired boolean;
begin
  insert into qbo_locks(resource, owner, expires_at)
  values(p_resource, p_owner, now() + interval '180 seconds')
  on conflict(resource) do update
    set owner = excluded.owner, expires_at = excluded.expires_at
    where qbo_locks.expires_at < now()
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;
revoke all on function public.qbo_acquire_lock(text, uuid) from public, anon, authenticated;
grant execute on function public.qbo_acquire_lock(text, uuid) to service_role;

create table public.reservation_invoices (
  id uuid primary key default gen_random_uuid(),
  gear_reservation_id uuid unique references public.gear_reservations(id),
  spaces_reservation_id uuid unique references public.spaces_reservations(id),
  check (num_nonnulls(gear_reservation_id, spaces_reservation_id) = 1),
  draft jsonb not null,
  revision integer not null default 1,
  status text not null default 'draft' check (status in ('draft','creating','created','sending','sent')),
  realm_id text,
  environment text check (environment in ('sandbox','production')),
  create_request_id uuid,
  send_request_id uuid,
  create_started_at timestamptz,
  send_started_at timestamptz,
  create_payload jsonb,
  qbo_invoice_id text,
  snapshot jsonb,
  sent_at timestamptz,
  last_error text,
  created_by text not null,
  updated_at timestamptz not null default now()
);
create unique index reservation_invoices_qbo_id on public.reservation_invoices
  (environment, realm_id, qbo_invoice_id) where qbo_invoice_id is not null;

create table public.qbo_invoice_activity (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.reservation_invoices(id),
  actor_email text not null,
  action text not null,
  created_at timestamptz not null default now()
);

alter table public.qbo_connection enable row level security;
alter table public.qbo_oauth_states enable row level security;
alter table public.qbo_locks enable row level security;
alter table public.reservation_invoices enable row level security;
alter table public.qbo_invoice_activity enable row level security;
revoke all on public.qbo_connection, public.qbo_oauth_states, public.qbo_locks,
  public.reservation_invoices, public.qbo_invoice_activity from anon, authenticated;
grant all on public.qbo_connection, public.qbo_oauth_states, public.qbo_locks,
  public.reservation_invoices, public.qbo_invoice_activity to service_role;
