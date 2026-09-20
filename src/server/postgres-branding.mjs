import { getPostgresPool, isPostgresConfigured } from './postgres.mjs';
import { normalizeBrandingAsset, removeBrandingImage } from './supabase-storage.mjs';

const colorKeys = new Set(['primary', 'secondary', 'accent', 'background', 'text']);
const hexColor = /^#[0-9a-f]{6}$/i;
const httpsUrl = /^https:\/\/[^\s]+$/i;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value, label, maxLength, { optional = false } = {}) {
  if (value == null || value === '') {
    if (optional) return null;
    throw new Error(`${label} é obrigatório.`);
  }
  if (typeof value !== 'string') throw new Error(`${label} é inválido.`);
  const normalized = value.trim();
  if (!normalized && optional) return null;
  if (!normalized || normalized.length > maxLength) throw new Error(`${label} é inválido.`);
  return normalized;
}

function optionalHttpsUrl(value, label) {
  if (value == null || value === '') return null;
  const normalized = text(value, label, 1000);
  if (!httpsUrl.test(normalized)) throw new Error(`${label} deve usar uma URL HTTPS válida.`);
  return normalized;
}

function colors(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('As cores são inválidas.');
  const entries = Object.entries(value);
  if (entries.some(([key, color]) => !colorKeys.has(key) || typeof color !== 'string' || !hexColor.test(color))) {
    throw new Error('As cores devem usar somente os campos visuais permitidos e valores hexadecimais.');
  }
  return Object.fromEntries(entries);
}

function year(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 2000 || normalized > 2100) throw new Error('Ano inválido.');
  return normalized;
}

function active(value) {
  if (typeof value !== 'boolean') throw new Error('Situação do tema inválida.');
  return value;
}

function toPublicBranding(church, theme) {
  if (!church && !theme) return null;
  return {
    applicationName: church?.app_name ?? null,
    churchName: church?.church_name ?? null,
    logoUrl: church?.logo_url ?? '',
    annualTheme: theme ? {
      id: theme.id,
      name: theme.title,
      subtitle: theme.subtitle ?? '',
      year: theme.year,
      bannerUrl: theme.banner_url ?? '',
      colors: theme.colors ?? null
    } : null
  };
}

function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input || {}, key);
}

function imageChange(input, key, kind) {
  if (!hasOwn(input, key)) return undefined;
  if (input[key] === null) return null;
  return normalizeBrandingAsset(input[key], kind);
}

function storedAsset(row, bucketKey, pathKey) {
  return row?.[bucketKey] && row?.[pathKey] ? { bucket: row[bucketKey], path: row[pathKey] } : null;
}

async function withClient(work) {
  if (!isPostgresConfigured()) return null;
  const client = await getPostgresPool().connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

async function postgresAdminId(client, actor) {
  const email = String(actor?.email || '').trim().toLowerCase();
  const whatsapp = String(actor?.whatsapp || '').replace(/\D/g, '');
  if (!email && !whatsapp) throw new Error('Administrador PostgreSQL correspondente não localizado.');
  const result = await client.query(
    `select users.id
       from public.app_users users
       join public.people people on people.id = users.person_id
       join public.user_roles roles on roles.user_id = users.id and roles.role_code = 'admin'
      where users.is_active
        and (people.email = $1 or people.whatsapp = $2)
      limit 1`,
    [email || null, whatsapp || null]
  );
  if (!result.rowCount) throw new Error('Administrador PostgreSQL correspondente não localizado.');
  return result.rows[0].id;
}

async function audit(client, actorUserId, action, entityType, entityId, summary, metadata) {
  await client.query(
    `insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, summary, metadata)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [actorUserId, action, entityType, entityId, summary, JSON.stringify(metadata)]
  );
}

export async function getPublicBranding() {
  return withClient(async (client) => {
    const [church, theme] = await Promise.all([
      client.query('select app_name, church_name, logo_url from public.church_branding where id = true'),
      client.query(`select id, year, title, subtitle, colors, banner_url
                      from public.annual_themes
                     where is_active = true
                     limit 1`)
    ]);
    return toPublicBranding(church.rows[0], theme.rows[0]);
  });
}

export async function getBrandingAdministration() {
  return withClient(async (client) => {
    const [church, themes] = await Promise.all([
      client.query('select app_name, church_name, logo_url, logo_storage_bucket, logo_storage_path from public.church_branding where id = true'),
      client.query(`select id, year, title, subtitle, colors, banner_url, banner_storage_bucket, banner_storage_path, is_active
                      from public.annual_themes
                     order by year desc`)
    ]);
    return { church: church.rows[0] ?? null, themes: themes.rows };
  });
}

export async function saveChurchBranding(actor, input) {
  return withClient(async (client) => {
    const appName = text(input.appName, 'Nome do aplicativo', 80);
    const churchName = text(input.churchName, 'Nome da igreja', 120);
    const logoChange = imageChange(input, 'logoAsset', 'logo');
    try {
      await client.query('begin');
      const actorUserId = await postgresAdminId(client, actor);
      const current = await client.query('select logo_url, logo_storage_bucket, logo_storage_path from public.church_branding where id = true');
      const currentLogo = current.rows[0] || {};
      const logo = logoChange === undefined
        ? { url: currentLogo.logo_url ?? null, bucket: currentLogo.logo_storage_bucket ?? null, path: currentLogo.logo_storage_path ?? null }
        : logoChange
          ? { url: logoChange.url, bucket: logoChange.bucket, path: logoChange.path }
          : { url: null, bucket: null, path: null };
      const result = await client.query(
        `insert into public.church_branding (id, app_name, church_name, logo_url, logo_storage_bucket, logo_storage_path)
         values (true, $1, $2, $3, $4, $5)
         on conflict (id) do update set app_name = excluded.app_name, church_name = excluded.church_name,
           logo_url = excluded.logo_url, logo_storage_bucket = excluded.logo_storage_bucket, logo_storage_path = excluded.logo_storage_path
         returning app_name, church_name, logo_url, logo_storage_bucket, logo_storage_path`,
        [appName, churchName, logo.url, logo.bucket, logo.path]
      );
      await audit(client, actorUserId, 'update_branding', 'church_branding', 'true', 'Identidade permanente atualizada.', { fields: ['app_name', 'church_name', 'logo_asset'] });
      await client.query('commit');
      const oldAsset = storedAsset(currentLogo, 'logo_storage_bucket', 'logo_storage_path');
      if (oldAsset && (oldAsset.bucket !== logo.bucket || oldAsset.path !== logo.path)) await removeBrandingImage(oldAsset).catch(() => {});
      return result.rows[0];
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

export async function saveAnnualTheme(actor, input) {
  return withClient(async (client) => {
    const id = input.id ? text(input.id, 'Tema anual', 36) : null;
    if (id && !uuid.test(id)) throw new Error('Tema anual inválido.');
    const normalizedYear = year(input.year);
    const title = text(input.name, 'Nome do tema', 160);
    const subtitle = text(input.subtitle, 'Frase do tema', 240, { optional: true });
    const themeColors = colors(input.colors);
    const bannerChange = imageChange(input, 'bannerAsset', 'banner');
    const isActive = active(input.isActive);
    try {
      await client.query('begin');
      const actorUserId = await postgresAdminId(client, actor);
      if (isActive) await client.query('update public.annual_themes set is_active = false where is_active');
      const current = id
        ? await client.query('select banner_url, banner_storage_bucket, banner_storage_path from public.annual_themes where id = $1', [id])
        : { rows: [] };
      const currentBanner = current.rows[0] || {};
      const banner = bannerChange === undefined
        ? { url: currentBanner.banner_url ?? null, bucket: currentBanner.banner_storage_bucket ?? null, path: currentBanner.banner_storage_path ?? null }
        : bannerChange
          ? { url: bannerChange.url, bucket: bannerChange.bucket, path: bannerChange.path }
          : { url: null, bucket: null, path: null };
      const result = id
        ? await client.query(
          `update public.annual_themes
              set year = $2, title = $3, subtitle = $4, colors = $5::jsonb, banner_url = $6,
                  banner_storage_bucket = $7, banner_storage_path = $8, is_active = $9
            where id = $1
          returning id, year, title, subtitle, colors, banner_url, banner_storage_bucket, banner_storage_path, is_active`,
          [id, normalizedYear, title, subtitle, themeColors ? JSON.stringify(themeColors) : null, banner.url, banner.bucket, banner.path, isActive]
        )
        : await client.query(
          `insert into public.annual_themes (year, title, subtitle, colors, banner_url, banner_storage_bucket, banner_storage_path, is_active)
           values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
           returning id, year, title, subtitle, colors, banner_url, banner_storage_bucket, banner_storage_path, is_active`,
          [normalizedYear, title, subtitle, themeColors ? JSON.stringify(themeColors) : null, banner.url, banner.bucket, banner.path, isActive]
        );
      if (!result.rowCount) throw new Error('Tema anual não encontrado.');
      await audit(client, actorUserId, id ? 'update_annual_theme' : 'create_annual_theme', 'annual_theme', result.rows[0].id, 'Tema anual atualizado.', { fields: ['year', 'title', 'subtitle', 'colors', 'banner_asset', 'is_active'] });
      await client.query('commit');
      const oldAsset = storedAsset(currentBanner, 'banner_storage_bucket', 'banner_storage_path');
      if (oldAsset && (oldAsset.bucket !== banner.bucket || oldAsset.path !== banner.path)) await removeBrandingImage(oldAsset).catch(() => {});
      return result.rows[0];
    } catch (error) {
      await client.query('rollback').catch(() => {});
      if (error?.code === '23505') throw new Error('Já existe um tema para este ano.');
      throw error;
    }
  });
}
