import { randomUUID } from 'node:crypto';

export const BRANDING_BUCKET = 'church-branding-assets';
export const BRANDING_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const imageTypes = new Map([
  ['image/png', { extension: 'png', valid: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['image/jpeg', { extension: 'jpg', valid: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/webp', { extension: 'webp', valid: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from('RIFF')) && buffer.subarray(8, 12).equals(Buffer.from('WEBP')) }]
]);
const kinds = new Set(['logo', 'banner', 'background']);
const assetPath = /^(logo|banner|background)\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;

function controlledError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function supabaseUrl() {
  const value = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!value) throw controlledError('O armazenamento de imagens ainda não está configurado.', 503);
  let parsed;
  try { parsed = new URL(value); } catch { throw controlledError('O armazenamento de imagens ainda não está configurado.', 503); }
  if (parsed.protocol !== 'https:') throw controlledError('O armazenamento de imagens ainda não está configurado.', 503);
  return parsed.toString().replace(/\/$/, '');
}

function serviceRoleKey() {
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!key) throw controlledError('O armazenamento de imagens ainda não está configurado.', 503);
  return key;
}

function assertKind(kind) {
  if (!kinds.has(kind)) throw controlledError('Tipo de imagem inválido.');
  return kind;
}

export function isSupabaseStorageConfigured() {
  return Boolean(String(process.env.SUPABASE_URL || '').trim() && String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim());
}

export function publicBrandingAssetUrl(bucket, path) {
  if (bucket !== BRANDING_BUCKET || !assetPath.test(String(path || ''))) throw controlledError('Referência de imagem inválida.');
  const encodedPath = String(path).split('/').map(encodeURIComponent).join('/');
  return `${supabaseUrl()}/storage/v1/object/public/${BRANDING_BUCKET}/${encodedPath}`;
}

export function normalizeBrandingAsset(asset, kind) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw controlledError('Referência de imagem inválida.');
  const normalizedKind = assertKind(kind);
  const bucket = String(asset.bucket || '');
  const path = String(asset.path || '');
  if (bucket !== BRANDING_BUCKET || !path.startsWith(`${normalizedKind}/`) || !assetPath.test(path)) {
    throw controlledError('Referência de imagem inválida.');
  }
  return { bucket, path, url: publicBrandingAssetUrl(bucket, path) };
}

async function readImage(request) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > BRANDING_MAX_IMAGE_BYTES) throw controlledError('A imagem deve ter no máximo 5 MB.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BRANDING_MAX_IMAGE_BYTES) throw controlledError('A imagem deve ter no máximo 5 MB.');
    chunks.push(chunk);
  }
  if (!size) throw controlledError('Selecione uma imagem para enviar.');
  return Buffer.concat(chunks);
}

function imageType(request, buffer) {
  const mime = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  const definition = imageTypes.get(mime);
  if (!definition || !definition.valid(buffer)) throw controlledError('Envie uma imagem PNG, JPEG ou WebP válida.');
  return { mime, extension: definition.extension };
}

async function storageRequest(path, options) {
  const response = await fetch(`${supabaseUrl()}${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey(),
      Authorization: `Bearer ${serviceRoleKey()}`,
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw controlledError('Não foi possível concluir o envio da imagem.', 503);
}

export async function uploadBrandingImage(request, kind) {
  const normalizedKind = assertKind(kind);
  const buffer = await readImage(request);
  const image = imageType(request, buffer);
  const path = `${normalizedKind}/${randomUUID()}.${image.extension}`;
  await storageRequest(`/storage/v1/object/${BRANDING_BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': image.mime, 'x-upsert': 'false' },
    body: buffer
  });
  return { bucket: BRANDING_BUCKET, path, url: publicBrandingAssetUrl(BRANDING_BUCKET, path) };
}

export async function removeBrandingImage(asset) {
  if (!asset?.bucket || !asset?.path) return;
  const path = String(asset.path);
  const kind = path.startsWith('banner/') ? 'banner' : path.startsWith('background/') ? 'background' : 'logo';
  const normalized = normalizeBrandingAsset(asset, kind);
  await storageRequest(`/storage/v1/object/${BRANDING_BUCKET}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [normalized.path] })
  });
}
