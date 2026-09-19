-- Identidade permanente e tema anual são configurações independentes.
-- Esta migration não insere qualquer valor de marca, tema ou dado fictício.

create or replace function public.annual_theme_colors_are_safe(payload jsonb)
returns boolean
language sql
immutable
as $$
  select case
    when payload is null then true
    when jsonb_typeof(payload) <> 'object' then false
    else not exists (
      select 1
      from jsonb_each_text(payload) as color(key, value)
      where color.key not in ('primary', 'secondary', 'accent', 'background', 'text')
         or color.value !~ '^#[0-9A-Fa-f]{6}$'
    )
  end;
$$;

alter table public.annual_themes
  add column subtitle text,
  add column colors jsonb,
  add column banner_url text;

-- Storage continua suportado. O caminho passa a ser opcional para permitir o
-- uso inicial de uma URL HTTPS sem improvisar upload de arquivo.
alter table public.annual_themes
  alter column banner_storage_path drop not null;

alter table public.annual_themes
  add constraint annual_themes_subtitle_check
    check (subtitle is null or length(btrim(subtitle)) between 1 and 240),
  add constraint annual_themes_colors_check
    check (public.annual_theme_colors_are_safe(colors)),
  add constraint annual_themes_banner_url_check
    check (banner_url is null or (length(btrim(banner_url)) between 8 and 1000 and btrim(banner_url) ~ '^https://[^[:space:]]+$'));

create table public.church_branding (
  id boolean primary key default true check (id),
  app_name text not null check (length(btrim(app_name)) between 1 and 80),
  church_name text not null check (length(btrim(church_name)) between 1 and 120),
  logo_url text check (logo_url is null or (length(btrim(logo_url)) between 8 and 1000 and btrim(logo_url) ~ '^https://[^[:space:]]+$')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger church_branding_set_updated_at
before update on public.church_branding
for each row execute function public.set_updated_at();

alter table public.church_branding enable row level security;

-- Não há policies nesta migration. A leitura pública será entregue somente
-- pelo backend Node com projeção explícita; gravação continua administrativa.
