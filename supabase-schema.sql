create extension if not exists pgcrypto;

create table if not exists public.runner_workspaces (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  draft_profile jsonb,
  app_state jsonb,
  selected_date date,
  view_year integer,
  view_month integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_runner_workspaces_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_runner_workspaces_updated_at on public.runner_workspaces;
create trigger trg_runner_workspaces_updated_at
before update on public.runner_workspaces
for each row
execute function public.set_runner_workspaces_updated_at();

alter table public.runner_workspaces enable row level security;

grant select, insert, update, delete on public.runner_workspaces to authenticated;

drop policy if exists "runner_workspaces_select_own" on public.runner_workspaces;
create policy "runner_workspaces_select_own"
on public.runner_workspaces
for select
using (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "runner_workspaces_insert_own" on public.runner_workspaces;
create policy "runner_workspaces_insert_own"
on public.runner_workspaces
for insert
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "runner_workspaces_update_own" on public.runner_workspaces;
create policy "runner_workspaces_update_own"
on public.runner_workspaces
for update
using (auth.uid() is not null and auth.uid() = user_id)
with check (auth.uid() is not null and auth.uid() = user_id);

drop policy if exists "runner_workspaces_delete_own" on public.runner_workspaces;
create policy "runner_workspaces_delete_own"
on public.runner_workspaces
for delete
using (auth.uid() is not null and auth.uid() = user_id);
