-- Integrate the WhatsApp Ordering Assistant into the shared Arkflow ERP.
-- Applied to the shared ERP project (zmvifznqrozpfkfxdxdg).
-- Everything here is scoped to client_id = 3 (Arkflow), except two additive,
-- nullable columns on service_tariffs (safe for the other tenants / Products page).

-- 1. Additive columns so the transport-shaped service_tariffs can also hold
--    Arkflow's generic products/services (category grouping + a description the
--    bot can search). Other clients leave these null; the Products page ignores them.
alter table public.service_tariffs add column if not exists category    text;
alter table public.service_tariffs add column if not exists description  text;

-- 2. The bot's automation row (mirrors Avicsa's #19 "Whatsapp: Order Intake").
--    Drives the coworker card + KPIs on the dashboard once runs start logging.
insert into public.automations
  (client_id, automation_name, automation_name_local, status, manual_execution_time_min, manual_hourly_cost)
select 3, 'Whatsapp: Order Intake', 'WhatsApp: Recepción de Pedidos', 'Testing', 1, 10
where not exists (
  select 1 from public.automations where client_id = 3 and automation_name = 'Whatsapp: Order Intake'
);

-- Link it to a client-visible team member (Carla, id=1) — same as Avicsa's bot —
-- otherwise it won't render on any coworker card.
insert into public.team_members_automations (team_member_id, automation_id)
select 1, a.id
from public.automations a
where a.client_id = 3 and a.automation_name = 'Whatsapp: Order Intake'
  and not exists (
    select 1 from public.team_members_automations tma
    where tma.team_member_id = 1 and tma.automation_id = a.id
  );

-- 3. Seed the catalog into service_tariffs from the interim catalog_items table.
--    code = sku, category = category slug, so the bot can still group by category.
insert into public.service_tariffs
  (client_id, code, name, description, base_price, currency, unit, active, category)
select ci.client_id, ci.sku, ci.name, ci.description, ci.price, ci.currency, ci.unit, ci.active, cat.slug
from public.catalog_items ci
join public.categories cat on cat.id = ci.category_id
where ci.client_id = 3
  and not exists (select 1 from public.service_tariffs where client_id = 3);
