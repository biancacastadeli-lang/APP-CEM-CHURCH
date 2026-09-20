-- Fotos pessoais são privadas e pertencem ao cadastro único de cada pessoa.
-- Esta migration não cria pessoas, usuários, fotos ou acessos.

alter table public.people
  add column photo_storage_bucket text,
  add column photo_storage_path text;

alter table public.people
  add constraint people_photo_storage_pair_check
    check (
      (photo_storage_bucket is null and photo_storage_path is null)
      or (
        photo_storage_bucket = 'person-profile-photos'
        and photo_storage_path ~ '^profiles/[0-9a-f-]{36}\.(png|jpe?g|webp)$'
      )
    );

-- O bucket é deliberadamente privado. Não há policies para cliente: upload,
-- leitura e remoção passam somente pelas rotas Node autorizadas.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'person-profile-photos',
  'person-profile-photos',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- O Supabase gerenciado controla RLS em storage.objects. Não criamos policies
-- públicas, inclusive de leitura. O backend Node usa a credencial de serviço
-- somente no servidor e aplica autorização por rota.
