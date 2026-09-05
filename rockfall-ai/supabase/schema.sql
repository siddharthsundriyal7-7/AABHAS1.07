-- Run this in Supabase → SQL Editor, once, on a fresh project.

-- 1. Profiles: one row per auth user, holds role (worker/admin)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'worker' check (role in ('worker', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles are viewable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles are editable by their owner"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. Detections: one row per captured/classified frame
create table if not exists public.detections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  source text not null check (source in ('camera', 'drone')),
  device text not null,
  risk_level text not null check (risk_level in ('high', 'low')),
  created_at timestamptz not null default now()
);

alter table public.detections enable row level security;

-- Everyone signed in can see every detection (a shared safety feed);
-- tighten to `auth.uid() = user_id` if you want per-user isolation instead.
create policy "signed-in users can read all detections"
  on public.detections for select
  using (auth.role() = 'authenticated');

create policy "users can insert their own detections"
  on public.detections for insert
  with check (auth.uid() = user_id);

-- 3. Storage bucket for captured frames
insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

create policy "signed-in users can upload captures"
  on storage.objects for insert
  with check (bucket_id = 'captures' and auth.role() = 'authenticated');

create policy "signed-in users can read captures"
  on storage.objects for select
  using (bucket_id = 'captures' and auth.role() = 'authenticated');
