-- The whole backend, essentially: an append-only ordered log of field-level ops.
-- Note there are no tables mirroring bullets/shots/huddles. That is deliberate.
-- Adding an entity type or a field must never require a migration, because the
-- two clients update independently and we change this app a lot.

create table if not exists ops (
  seq        bigserial primary key,
  op_id      text unique not null,   -- client-generated; makes retries idempotent
  entity     text not null,
  entity_id  text not null,
  field      text not null,
  value      jsonb,
  ts         bigint not null,        -- client clock, drives last-write-wins
  actor      text not null,
  created_at timestamptz not null default now()
);

create index if not exists ops_seq_idx on ops (seq);
create index if not exists ops_entity_idx on ops (entity, entity_id);

-- Ephemeral. Powers the "Angie is here" indicator on the live huddle board.
create table if not exists presence (
  person  text primary key,
  context text,
  seen_at timestamptz not null default now()
);
