create extension if not exists pgcrypto;

create table if not exists public.primers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  sequence text not null check (char_length(sequence) >= 4),
  normalized_sequence text not null check (normalized_sequence ~ '^[ACGTRYSWKMBDHVN]+$'),
  ordered_at date not null,
  enzyme_sites jsonb not null default '[]'::jsonb,
  notes text not null default '',
  binding_context jsonb,
  source_type text not null check (source_type in ('historical', 'snapgene-dna', 'snapgene-text', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists primers_user_ordered_idx on public.primers(user_id, ordered_at desc);
create index if not exists primers_user_sequence_idx on public.primers(user_id, normalized_sequence);
create index if not exists primers_name_fts_idx on public.primers using gin (to_tsvector('simple', name));

create table if not exists public.order_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  file_name text not null,
  storage_path text not null unique,
  mapping jsonb not null,
  defaults jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists templates_user_idx on public.order_templates(user_id, updated_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists primers_set_updated_at on public.primers;
create trigger primers_set_updated_at before update on public.primers
for each row execute function public.set_updated_at();

drop trigger if exists templates_set_updated_at on public.order_templates;
create trigger templates_set_updated_at before update on public.order_templates
for each row execute function public.set_updated_at();

alter table public.primers enable row level security;
alter table public.order_templates enable row level security;

drop policy if exists "users manage own primers" on public.primers;
create policy "users manage own primers" on public.primers
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users manage own templates" on public.order_templates;
create policy "users manage own templates" on public.order_templates
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-templates', 'order-templates', false, 10485760, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users read own template files" on storage.objects;
create policy "users read own template files" on storage.objects for select
using (bucket_id = 'order-templates' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users upload own template files" on storage.objects;
create policy "users upload own template files" on storage.objects for insert
with check (bucket_id = 'order-templates' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own template files" on storage.objects;
create policy "users delete own template files" on storage.objects for delete
using (bucket_id = 'order-templates' and (storage.foldername(name))[1] = auth.uid()::text);
