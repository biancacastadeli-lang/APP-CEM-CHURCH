import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const server = readFileSync(resolve('server.mjs'), 'utf8');
const people = readFileSync(resolve('src/server/postgres-people-cells.mjs'), 'utf8');
const photos = readFileSync(resolve('src/server/supabase-person-photos.mjs'), 'utf8');
const migration = readFileSync(resolve('supabase/migrations/20260919170000_add_person_access_and_private_photos.sql'), 'utf8');

for (const text of ['grantPersonAccess', 'revokePersonAccess', 'setPersonImageConsent', 'setPersonPhotoReference', 'personPhotoAsset']) {
  if (!people.includes(`export async function ${text}`)) throw new Error(`Fluxo de Pessoa/Acesso ausente: ${text}`);
}
for (const route of ['/access', '/image-consent', '/photo']) if (!server.includes(route)) throw new Error(`Rota de Pessoa ausente: ${route}`);
if (!people.includes('requireAdmin(actor)')) throw new Error('Operações administrativas devem exigir Admin no servidor.');
if (!people.includes('update public.app_sessions set revoked_at')) throw new Error('Revogação deve invalidar sessões existentes.');
if (!photos.includes("PERSON_PHOTO_BUCKET = 'person-profile-photos'")) throw new Error('Bucket privado de foto ausente.');
if (!photos.includes('/storage/v1/object/authenticated/')) throw new Error('Leitura de foto deve usar objeto autenticado.');
if (photos.includes('/storage/v1/object/public/')) throw new Error('Foto pessoal não pode usar URL pública.');
if (!migration.includes('false,') || /create policy/i.test(migration) || /alter\s+table\s+storage\.objects/i.test(migration)) {
  throw new Error('Storage pessoal deve ser privado, sem policy pública ou ALTER TABLE em storage.objects.');
}
if (/password_hash.*audit|password_salt.*audit/i.test(people)) throw new Error('Auditoria não pode registrar material de senha.');
console.log('Verificação estática de Pessoas, Acessos e Fotos concluída.');
