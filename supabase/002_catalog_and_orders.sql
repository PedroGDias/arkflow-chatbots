-- Ordering assistant catalog + cart/order tables.
-- Applied to the shared Arkflow ERP project (zmvifznqrozpfkfxdxdg).
-- Attributed to clients.id = 3 ("Arkflow").

create table if not exists categories (
  id bigint generated always as identity primary key,
  type text not null check (type in ('product', 'service')),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists catalog_items (
  id bigint generated always as identity primary key,
  client_id bigint not null references clients(id),
  category_id bigint not null references categories(id),
  name text not null,
  description text,
  price numeric not null,
  currency text not null default 'EUR',
  unit text,
  sku text,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists catalog_items_category_id_idx on catalog_items (category_id);
alter table catalog_items add constraint catalog_items_sku_key unique (sku);

create table if not exists orders (
  id bigint generated always as identity primary key,
  client_id bigint not null references clients(id),
  customer_id bigint not null references customers(id),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled', 'fulfilled')),
  currency text not null default 'EUR',
  total numeric not null default 0,
  source text not null default 'whatsapp',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_id_status_idx on orders (customer_id, status);

create table if not exists order_items (
  id bigint generated always as identity primary key,
  order_id bigint not null references orders(id) on delete cascade,
  catalog_item_id bigint not null references catalog_items(id),
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric not null,
  line_total numeric generated always as (quantity * unit_price) stored,
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items (order_id);
