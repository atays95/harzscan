-- =============================================================
--  HarzScan – Datenbank & Speicher einrichten
--  In Supabase: SQL Editor → "New query" → alles einfügen → "Run"
--  Prinzip: Jeder mit dem Link darf Fotos HOCHLADEN,
--           aber nur angemeldete Admins dürfen sie SEHEN, LABELN, LÖSCHEN.
-- =============================================================

-- 1) Tabelle für Fotos (eine Zeile pro Foto)
create table if not exists public.photos (
  id            uuid primary key,
  entry_id      uuid not null,                      -- ein Fleck = ein Eintrag (3 Fotos)
  shot          text not null check (shot in ('nah','uebersicht','schraeg')),
  hall          text not null check (char_length(hall) between 1 and 80),
  plate         text check (char_length(plate) <= 12),
  device_id     uuid,
  taken_at      timestamptz not null,
  storage_path  text not null unique,
  thumb_path    text,
  width         int,
  height        int,
  bytes         int,
  source        text check (source in ('live','system')),
  quality       jsonb,                              -- Helligkeit, Überbelichtung, Schärfe
  tilt          jsonb,                              -- Neigung des Handys beim Auslösen
  retake        boolean default false,
  app_version   text,
  created_at    timestamptz not null default now()
);
create index if not exists photos_entry_idx on public.photos (entry_id);
create index if not exists photos_taken_idx on public.photos (taken_at desc);

-- 2) Tabelle für Labels (eine Zeile pro Fleck, nur Admins)
create table if not exists public.labels (
  entry_id    uuid primary key,
  label       text check (label in ('harz_frisch','harz_alt','kein_harz','unsicher')),
  note        text check (char_length(note) <= 500),
  labeled_by  uuid default auth.uid(),
  labeled_at  timestamptz not null default now()
);

-- 3) Zugriffsregeln (Row Level Security)
alter table public.photos enable row level security;
alter table public.labels enable row level security;

drop policy if exists "jeder darf Fotos eintragen" on public.photos;
create policy "jeder darf Fotos eintragen" on public.photos
  for insert to anon, authenticated with check (true);

drop policy if exists "admins lesen Fotos" on public.photos;
create policy "admins lesen Fotos" on public.photos
  for select to authenticated using (true);

drop policy if exists "admins loeschen Fotos" on public.photos;
create policy "admins loeschen Fotos" on public.photos
  for delete to authenticated using (true);

drop policy if exists "admins verwalten Labels" on public.labels;
create policy "admins verwalten Labels" on public.labels
  for all to authenticated using (true) with check (true);

-- 4) Privater Speicher-Bucket für die Bilder (max. 20 MB, nur JPEG)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('harzscan', 'harzscan', false, 20971520, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = array['image/jpeg'];

drop policy if exists "jeder darf Bilder hochladen" on storage.objects;
create policy "jeder darf Bilder hochladen" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'harzscan');

drop policy if exists "admins lesen Bilder" on storage.objects;
create policy "admins lesen Bilder" on storage.objects
  for select to authenticated using (bucket_id = 'harzscan');

drop policy if exists "admins loeschen Bilder" on storage.objects;
create policy "admins loeschen Bilder" on storage.objects
  for delete to authenticated using (bucket_id = 'harzscan');

-- WICHTIG danach: Authentication → Sign In / Providers →
-- "Allow new users to sign up" AUSSCHALTEN. Sonst könnte sich jeder
-- selbst ein Konto anlegen und wäre damit "Admin".
