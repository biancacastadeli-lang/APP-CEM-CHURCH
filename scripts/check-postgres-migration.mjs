import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve('supabase/migrations/20260918190000_initial_mvp_schema.sql'), 'utf8');
const refinement = readFileSync(resolve('supabase/migrations/20260919100000_refine_mvp_operational_history.sql'), 'utf8');
const branding = readFileSync(resolve('supabase/migrations/20260919110000_add_configurable_branding.sql'), 'utf8');
const birthDate = readFileSync(resolve('supabase/migrations/20260919120000_add_people_birth_date.sql'), 'utf8');
const peopleAndFunctions = readFileSync(resolve('supabase/migrations/20260919130000_add_people_and_ministry_functions.sql'), 'utf8');
const meetingTime = readFileSync(resolve('supabase/migrations/20260919140000_add_meeting_time.sql'), 'utf8');
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
const refinementRequired = [
  "set meeting_status = 'held'", "meeting_status in ('scheduled', 'held', 'not_held')",
  'create table public.person_status_history', 'create trigger visitors_record_status_history',
  'create trigger referrals_record_status_history', 'create trigger care_cases_record_status_history',
  'create table public.meeting_offering_adjustments',
  'create trigger meeting_photos_require_authorized_uploader',
  'create trigger meeting_photos_require_leader_publication',
  'alter table public.person_status_history enable row level security',
  'alter table public.meeting_offering_adjustments enable row level security',
  'care_records. A camada Node nunca'
];
const missingRefinement = refinementRequired.filter((value) => !refinement.includes(value));
if (missingRefinement.length) throw new Error(`Complemento PostgreSQL incompleto: ${missingRefinement.join(', ')}`);
if (/(supabase_url|service_role|anon_key|postgres:\/\/[^\s]+|password\s*=\s*['\"]\S+)/i.test(refinement)) {
  throw new Error('O complemento PostgreSQL não pode conter credenciais ou URLs de conexão.');
}
const brandingRequired = [
  'create table public.church_branding', 'add column subtitle text', 'add column colors jsonb',
  'add column banner_url text', 'alter column banner_storage_path drop not null',
  'annual_theme_colors_are_safe', "('primary', 'secondary', 'accent', 'background', 'text')",
  'annual_themes_colors_check', 'annual_themes_banner_url_check',
  'create trigger church_branding_set_updated_at', 'alter table public.church_branding enable row level security'
];
const missingBranding = brandingRequired.filter((value) => !branding.includes(value));
if (missingBranding.length) throw new Error(`Migration de identidade incompleta: ${missingBranding.join(', ')}`);
if (/(supabase_url|service_role|anon_key|postgres:\/\/[^\s]+|password\s*=\s*['\"]\S+)/i.test(branding)) {
  throw new Error('A migration de identidade não pode conter credenciais ou URLs de conexão.');
}
if (!birthDate.includes('add column birth_date date null')) {
  throw new Error('Migration de data de nascimento incompleta.');
}
if (/(default|update public\.people|insert into public\.people|supabase_url|service_role|anon_key|postgres:\/\/[^\s]+|password\s*=\s*['\"]\S+)/i.test(birthDate)) {
  throw new Error('Migration de data de nascimento não pode preencher dados, criar valor padrão ou conter credenciais.');
}
const peopleAndFunctionsRequired = [
  'add column sex text', 'add column postal_code text', 'add column person_status text',
  "('member', 'visitor', 'integrating', 'inactive', 'transferred')",
  'create trigger people_record_person_status_history', "values (new.id, 'person'",
  'create table public.ministry_functions', 'create table public.person_ministry_assignments',
  "('host', 'Anfitrião', 'cell')", "('social_assistant', 'Assistente Social', 'cell')", "('treasurer', 'Tesoureiro', 'church')",
  'person_ministry_assignments_validate_scope', 'enable row level security'
];
const missingPeopleAndFunctions = peopleAndFunctionsRequired.filter((value) => !peopleAndFunctions.includes(value));
if (missingPeopleAndFunctions.length) throw new Error(`Migration de Pessoas e funções incompleta: ${missingPeopleAndFunctions.join(', ')}`);
if (/(insert into public\.people|insert into public\.cells|insert into public\.app_users|insert into public\.person_ministry_assignments|supabase_url|service_role|anon_key|postgres:\/\/[^\s]+|password\s*=\s*['\"]\S+)/i.test(peopleAndFunctions)) {
  throw new Error('Migration de Pessoas e funções não pode conter dados fictícios ou credenciais.');
}
if (!meetingTime.includes('add column meeting_time time null')) {
  throw new Error('Migration de horário histórico da reunião incompleta.');
}
if (/(default|update public\.cell_meetings|insert into public\.cell_meetings|supabase_url|service_role|anon_key|postgres:\/\/[^\s]+|password\s*=\s*['\"]\S+)/i.test(meetingTime)) {
  throw new Error('Migration de horário da reunião não pode preencher reuniões, criar valor padrão ou conter credenciais.');
}
console.log('Verificação da migration PostgreSQL concluída.');
