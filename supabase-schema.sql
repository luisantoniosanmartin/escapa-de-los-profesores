-- ESCAPA DE LOS PROFESORES: cuentas por nickname y progreso en la nube
-- Pegar TODO en Supabase > SQL Editor > New query y pulsar RUN.

-- 1) Perfil público: un nickname único por cuenta.
create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists player_profiles_username_lower_uidx
  on public.player_profiles (lower(username));

alter table public.player_profiles enable row level security;

drop policy if exists "Players read own profile" on public.player_profiles;
create policy "Players read own profile" on public.player_profiles
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Players insert own profile" on public.player_profiles;
create policy "Players insert own profile" on public.player_profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Players update own profile" on public.player_profiles;
create policy "Players update own profile" on public.player_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.player_profiles to authenticated;

-- 2) Al crear usuario en Auth, guardar su nickname. Si ya existe, cancelar el registro.
create or replace function public.create_player_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_name text;
begin
  chosen_name := coalesce(new.raw_user_meta_data ->> 'username', 'Jugador');
  if chosen_name !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Nickname inválido. Usa 3 a 20 letras, números o guion bajo.';
  end if;
  insert into public.player_profiles (user_id, username)
  values (new.id, chosen_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_player_profile on auth.users;
create trigger on_auth_user_created_player_profile
after insert on auth.users
for each row execute function public.create_player_profile();

-- 3) Tabla de progreso del juego.
create table if not exists public.player_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null default 'Jugador',
  progress jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.player_progress enable row level security;

drop policy if exists "Players read own progress" on public.player_progress;
create policy "Players read own progress" on public.player_progress
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Players insert own progress" on public.player_progress;
create policy "Players insert own progress" on public.player_progress
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Players update own progress" on public.player_progress;
create policy "Players update own progress" on public.player_progress
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.player_progress to authenticated;
