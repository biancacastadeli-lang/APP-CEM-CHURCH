import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const storage = readFileSync(resolve('src/server/supabase-storage.mjs'), 'utf8');
const server = readFileSync(resolve('server.mjs'), 'utf8');
const frontend = readFileSync(resolve('src/app.js'), 'utf8');

const requiredStorage = [
  "BRANDING_MAX_IMAGE_BYTES = 5 * 1024 * 1024", "'image/png'", "'image/jpeg'", "'image/webp'",
  'randomUUID()', 'SUPABASE_SERVICE_ROLE_KEY', 'normalizeBrandingAsset', 'removeBrandingImage'
];
const missingStorage = requiredStorage.filter((value) => !storage.includes(value));
if (missingStorage.length) throw new Error(`Proteção de Storage incompleta: ${missingStorage.join(', ')}`);
if (!server.includes("pathname === '/api/admin/branding/assets'") || !server.includes('uploadBrandingImage(request')) {
  throw new Error('Rota administrativa de upload ausente.');
}
if (!frontend.includes('uploadBrandingAsset') || !frontend.includes('name="logoFile"') || !frontend.includes('name="bannerFile"')) {
  throw new Error('Interface de upload de identidade incompleta.');
}
if (frontend.includes('name="logoUrl"') || frontend.includes('name="bannerUrl"')) {
  throw new Error('A interface não deve aceitar URLs externas para assets de identidade.');
}
console.log('Validação estática de Storage da identidade passou.');
