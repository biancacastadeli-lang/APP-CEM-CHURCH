import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve('supabase/migrations/20260918190000_initial_mvp_schema.sql'), 'utf8');
const required = [
  'create table public.people', 'create table public.app_users', 'create table public.user_roles',
  'create table public.cells', 'create table public.cell_memberships', 'create table public.cell_leaderships',
  'create table public.cell_secretaries', 'create table public.supervisor_cell_scopes',
  'create table public.formation_modules', 'create table public.person_formation_completions',
  'create table public.visitors', 'create table public.referrals', 'create table public.care_cases',
  'create table public.care_records', 'create table public.cell_referrals', 'create table public.cell_meetings',
  'create table public.meeting_attendance', 'create table public.meeting_photos',
  'create table public.meeting_offerings', 'create table public.annual_themes', 'create table public.notifications', 'create table public.audit_logs',
  'create table public.person_image_consent_records',
  'create unique index cell_memberships_one_active_person', 'where ended_at is null',
  'create unique index people_email_normalized_unique', 'create unique index people_whatsapp_normalized_unique',
  'create unique index cells_name_normalized_unique', 'new.whatsapp := regexp_replace',
  'create trigger people_normalize_identifiers', 'create trigger cells_normalize_name',
  'create trigger cell_referrals_require_active_cell', 'create trigger people_set_updated_at',
  'create trigger app_users_set_updated_at', 'create trigger meeting_offerings_set_updated_at',
  'create trigger annual_themes_set_updated_at', 'create trigger person_image_consent_records_sync_person',
  'create trigger supervisor_scopes_require_supervisor_role', 'create trigger user_roles_prevent_required_role_removal',
  'metadata jsonb not null default', 'audit_metadata_is_safe',
  "meeting_status in ('scheduled', 'completed', 'not_held')", "publication_status in ('uploaded', 'published')",
  "delivery_status in ('sent', 'returned')", 'administrative_note text not null default',
  'create unique index annual_themes_only_one_active',
  "('pastor', 'Pastor'", "('secretary', 'Secretaria'", "('integration', 'Integração'",
  'enable row level security'
];
const absent = required.filter((value) => !migration.includes(value));
if (absent.length) throw new Error(`Migration PostgreSQL incompleta: ${absent.join(', ')}`);
const forbidden = [
  'people_whatsapp_unique on public.people (whatsapp)',
  'people_email_unique on public.people (lower(email))',
  'not baptized or baptized_on is null or baptized_on <= current_date',
  'coalesce(old.whatsapp'
];
const present = forbidden.filter((value) => migration.includes(value));
if (present.length) throw new Error(`Migration PostgreSQL contém regra obsoleta: ${present.join(', ')}`);
if (/(supabase_url|service_role|anon_key|postgres:\/\/[^\s]+|password\s*=\s*['\"]\S+)/i.test(migration)) {
  throw new Error('A migration não pode conter credenciais ou URLs de conexão.');
}
console.log('Verificação da migration PostgreSQL concluída.');
