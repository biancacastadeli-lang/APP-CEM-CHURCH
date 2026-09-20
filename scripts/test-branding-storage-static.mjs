import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const storage = readFileSync(resolve('src/server/supabase-storage.mjs'), 'utf8');
const server = readFileSync(resolve('server.mjs'), 'utf8');
const frontend = readFileSync(resolve('src/app.js'), 'utf8');
const backgroundMigration = readFileSync(resolve('supabase/migrations/20260919180000_add_app_background_asset.sql'), 'utf8');

const requiredStorage = [
  "BRANDING_MAX_IMAGE_BYTES = 5 * 1024 * 1024", "'image/png'", "'image/jpeg'", "'image/webp'",
  'randomUUID()', 'SUPABASE_SERVICE_ROLE_KEY', 'normalizeBrandingAsset', 'removeBrandingImage'
];
const missingStorage = requiredStorage.filter((value) => !storage.includes(value));
if (missingStorage.length) throw new Error(`Proteção de Storage incompleta: ${missingStorage.join(', ')}`);
if (!server.includes("pathname === '/api/admin/branding/assets'") || !server.includes('uploadBrandingImage(request')) {
  throw new Error('Rota administrativa de upload ausente.');
}
if (!storage.includes("'background'") || !storage.includes('logo|banner|background') || !storage.includes("path.startsWith('background/') ? 'background'")) {
  throw new Error('Storage da identidade deve aceitar o fundo público com caminho seguro.');
}
if (!frontend.includes('uploadBrandingAsset') || !frontend.includes('name="logoFile"') || !frontend.includes('name="bannerFile"') || !frontend.includes('name="backgroundFile"')) {
  throw new Error('Interface de upload de identidade incompleta.');
}
if (frontend.includes('name="logoUrl"') || frontend.includes('name="bannerUrl"')) {
  throw new Error('A interface não deve aceitar URLs externas para assets de identidade.');
}
const requiredBackground = [
  'add column if not exists background_storage_bucket text',
  'add column if not exists background_storage_path text',
  'church_branding_background_storage_pair_check',
  "background_storage_bucket = 'church-branding-assets'",
  "'^background/[0-9a-f-]{36}\\.(png|jpe?g|webp)$'"
];
const missingBackground = requiredBackground.filter((value) => !backgroundMigration.includes(value));
if (missingBackground.length || /alter\s+table\s+storage\.objects|create\s+policy/i.test(backgroundMigration)) {
  throw new Error(`Migration do fundo público inválida: ${missingBackground.join(', ')}`);
}
console.log('Validação estática de Storage da identidade passou.');
