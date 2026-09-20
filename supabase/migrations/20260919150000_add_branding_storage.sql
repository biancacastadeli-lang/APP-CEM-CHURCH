-- Assets públicos e não sensíveis usados na identidade visual da igreja.
-- O conteúdo dos arquivos fica no Supabase Storage; PostgreSQL guarda somente
-- a referência necessária para renderização e administração.

alter table public.church_branding
  add column logo_storage_bucket text,
  add column logo_storage_path text;

alter table public.church_branding
  add constraint church_branding_logo_storage_pair_check
    check (
      (logo_storage_bucket is null and logo_storage_path is null)
      or (
        logo_storage_bucket = 'church-branding-assets'
        and logo_storage_path ~ '^logo/[0-9a-f-]{36}\.(png|jpe?g|webp)$'
      )
    );

-- A migration anterior tornou o caminho opcional para suportar o fallback.
-- O bucket legado pode continuar presente sem caminho, sem modificar temas já
-- existentes. Novos uploads são sempre gravados com bucket e caminho válidos.
alter table public.annual_themes
  alter column banner_storage_bucket drop not null,
  alter column banner_storage_bucket drop default;

alter table public.annual_themes
  add constraint annual_themes_banner_storage_pair_check
    check (
      banner_storage_path is null
      or (
        banner_storage_bucket = 'church-branding-assets'
        and banner_storage_path ~ '^banner/[0-9a-f-]{36}\.(png|jpe?g|webp)$'
      )
      or (
        banner_storage_bucket is not null
        and banner_storage_bucket <> 'church-branding-assets'
        and length(btrim(banner_storage_path)) between 1 and 500
      )
    );

-- Publico somente para leitura dos assets de marca. Não há policy de escrita:
-- uploads e remoções são feitos exclusivamente pelo backend Node autenticado
-- com a credencial de serviço mantida fora do repositório.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'church-branding-assets',
  'church-branding-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- O Supabase gerenciado controla RLS em storage.objects. Deliberadamente não
-- criamos policies de escrita: o bucket público permite somente leitura dos
-- arquivos públicos; upload e remoção continuam restritos ao backend Node.
