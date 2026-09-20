-- Fundo público opcional da identidade permanente da igreja.
-- O arquivo fica em church-branding-assets; PostgreSQL guarda apenas a referência.

alter table public.church_branding
  add column if not exists background_storage_bucket text,
  add column if not exists background_storage_path text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'church_branding_background_storage_pair_check'
       and conrelid = 'public.church_branding'::regclass
  ) then
    alter table public.church_branding
      add constraint church_branding_background_storage_pair_check
      check (
        (background_storage_bucket is null and background_storage_path is null)
        or (
          background_storage_bucket = 'church-branding-assets'
          and background_storage_path ~ '^background/[0-9a-f-]{36}\.(png|jpe?g|webp)$'
        )
      );
  end if;
end $$;

-- Não cria bucket nem policy: church-branding-assets já existe e é público
-- somente para leitura. Upload e remoção permanecem no backend Node autorizado.
