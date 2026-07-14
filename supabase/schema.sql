create table if not exists messages (
  id bigint generated always as identity primary key,
  phone_number text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_phone_number_created_at_idx
  on messages (phone_number, created_at);
