import { randomUUID } from 'node:crypto';

export const PERSON_PHOTO_BUCKET = 'person-profile-photos';
export const PERSON_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

const imageTypes = new Map([
  ['image/png', { extension: 'png', valid: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) }],
  ['image/jpeg', { extension: 'jpg', valid: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ['image/webp', { extension: 'webp', valid: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from('RIFF')) && buffer.subarray(8, 12).equals(Buffer.from('WEBP')) }]
]);
const assetPath = /^profiles\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/;

function controlledError(message, status = 400) { const error = new Error(message); error.status = status; return error; }
function supabaseUrl() {
  const value = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!value) throw controlledError('O armazenamento de fotos ainda não está configurado.', 503);
  let parsed; try { parsed = new URL(value); } catch { throw controlledError('O armazenamento de fotos ainda não está configurado.', 503); }
  if (parsed.protocol !== 'https:') throw controlledError('O armazenamento de fotos ainda não está configurado.', 503);
  return parsed.toString().replace(/\/$/, '');
}
function serviceRoleKey() { const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(); if (!key) throw controlledError('O armazenamento de fotos ainda não está configurado.', 503); return key; }

export function normalizePersonPhotoAsset(asset) {
  if (!asset || asset.bucket !== PERSON_PHOTO_BUCKET || !assetPath.test(String(asset.path || ''))) throw controlledError('Referência de foto inválida.');
  return { bucket: PERSON_PHOTO_BUCKET, path: String(asset.path) };
}

async function readImage(request) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > PERSON_PHOTO_MAX_BYTES) throw controlledError('A foto deve ter no máximo 5 MB.');
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > PERSON_PHOTO_MAX_BYTES) throw controlledError('A foto deve ter no máximo 5 MB.'); chunks.push(chunk); }
  if (!size) throw controlledError('Selecione uma foto para enviar.');
  return Buffer.concat(chunks);
}
function imageType(request, buffer) {
  const mime = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  const definition = imageTypes.get(mime);
  if (!definition || !definition.valid(buffer)) throw controlledError('Envie uma imagem PNG, JPEG ou WebP válida.');
  return { mime, extension: definition.extension };
}
async function storageRequest(path, options = {}) {
  const key = serviceRoleKey();
  const response = await fetch(`${supabaseUrl()}${path}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...(options.headers || {}) } });
  if (!response.ok) throw controlledError('Não foi possível concluir a operação com a foto.', 503);
  return response;
}

export async function uploadPersonPhoto(request) {
  const buffer = await readImage(request); const image = imageType(request, buffer); const path = `profiles/${randomUUID()}.${image.extension}`;
  await storageRequest(`/storage/v1/object/${PERSON_PHOTO_BUCKET}/${path}`, { method: 'POST', headers: { 'Content-Type': image.mime, 'x-upsert': 'false' }, body: buffer });
  return { bucket: PERSON_PHOTO_BUCKET, path };
}
export async function removePersonPhoto(asset) {
  if (!asset?.bucket || !asset?.path) return;
  const normalized = normalizePersonPhotoAsset(asset);
  await storageRequest(`/storage/v1/object/${PERSON_PHOTO_BUCKET}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [normalized.path] }) });
}
export async function readPersonPhoto(asset) {
  const normalized = normalizePersonPhotoAsset(asset);
  const encodedPath = normalized.path.split('/').map(encodeURIComponent).join('/');
  const response = await storageRequest(`/storage/v1/object/authenticated/${PERSON_PHOTO_BUCKET}/${encodedPath}`);
  return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') || 'application/octet-stream' };
}
