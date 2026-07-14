-- Assign the "orders" AI worker (Carla, team_member 1 — the same worker Avicsa's
-- order-intake bot uses) to Arkflow (client 3). Without this row the dashboard
-- renders no coworker card for Arkflow and automation 22 attaches to nothing:
-- data.ts builds coworkers by filtering team_members to those in team_members_clients
-- for the client, then only shows automations linked to those visible workers.
insert into public.team_members_clients (team_member_id, client_id)
select 1, 3
where not exists (
  select 1 from public.team_members_clients where team_member_id = 1 and client_id = 3
);
