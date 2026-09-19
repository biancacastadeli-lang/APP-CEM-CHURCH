-- CEM CONNECT — esquema inicial PostgreSQL/Supabase.
-- Esta migration não contém credenciais nem dados ministeriais.
-- A aplicação continua usando SQLite até uma etapa posterior de migração.

create extension if not exists pgcrypto;

create table public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  whatsapp text not null default '' check (whatsapp = '' or whatsapp ~ '^[0-9]{10,13}$'),
  email text,
  baptized boolean not null default false,
  baptized_on date,
  image_consent boolean not null default false,
  image_consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email is null or length(btrim(email)) between 3 and 254),
  check (baptized or baptized_on is null),
  check (not image_consent or image_consented_at is not null)
);

-- Os triggers abaixo persistem e-mail e WhatsApp em formato canônico antes
-- destes índices serem verificados; por isso não dependemos de índice regex.
create unique index people_email_normalized_unique on public.people (email) where email is not null;
create unique index people_whatsapp_normalized_unique on public.people (whatsapp) where whatsapp <> '';

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.people(id) on delete restrict,
  password_hash text not null,
  password_salt text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(password_hash) > 0),
  check (length(password_salt) > 0)
);

-- Mantém o estado atual na pessoa e um histórico simples de cada registro de
-- consentimento, sem armazenar imagens no banco.
create table public.person_image_consent_records (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  authorized boolean not null,
  source text not null default 'administrative_record' check (length(btrim(source)) between 1 and 100),
  recorded_by_user_id uuid references public.app_users(id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index person_image_consent_records_person_created_at
  on public.person_image_consent_records (person_id, recorded_at desc);

create table public.roles (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null unique,
  description text not null default ''
);

create table public.user_roles (
  user_id uuid not null references public.app_users(id) on delete cascade,
  role_code text not null references public.roles(code) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_code)
);

create table public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (expires_at > created_at)
);

create index app_sessions_active_lookup on public.app_sessions (token_hash, expires_at) where revoked_at is null;

create table public.cells (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  weekday smallint not null check (weekday between 0 and 6),
  meeting_time time not null,
  address_line text not null check (length(btrim(address_line)) between 1 and 180),
  neighborhood text not null check (length(btrim(neighborhood)) between 1 and 100),
  city text not null check (length(btrim(city)) between 1 and 100),
  state text not null check (length(btrim(state)) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index cells_name_normalized_unique on public.cells (lower(name));

-- Membresia e liderança são relações independentes. Uma pessoa só pode ter
-- uma membresia ativa, mas pode liderar sem se tornar membro dessa célula.
create table public.cell_memberships (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null references public.cells(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index cell_memberships_one_active_person
  on public.cell_memberships (person_id)
  where ended_at is null;
create unique index cell_memberships_one_active_pair
  on public.cell_memberships (cell_id, person_id)
  where ended_at is null;

create table public.cell_leaderships (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null references public.cells(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index cell_leaderships_one_current_leader
  on public.cell_leaderships (cell_id)
  where ended_at is null;

create table public.cell_secretaries (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null references public.cells(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index cell_secretaries_one_current_assignment
  on public.cell_secretaries (cell_id, person_id)
  where ended_at is null;

create table public.supervisor_cell_scopes (
  user_id uuid not null references public.app_users(id) on delete cascade,
  cell_id uuid not null references public.cells(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key (user_id, cell_id)
);

create table public.formation_modules (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null unique,
  description text not null default '',
  display_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.person_formation_completions (
  person_id uuid not null references public.people(id) on delete cascade,
  module_code text not null references public.formation_modules(code) on delete restrict,
  completed_on date,
  recorded_by_user_id uuid references public.app_users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (person_id, module_code)
);

-- Visitante mantém somente dados básicos de recepção. Notas de cuidado ficam
-- exclusivamente nas tabelas care_cases/care_records abaixo.
create table public.visitors (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.people(id) on delete restrict,
  source text not null check (length(btrim(source)) between 1 and 100),
  reception_status text not null default 'new' check (reception_status in ('new', 'confirmed', 'sent_to_care', 'closed')),
  consent_contact boolean not null default false,
  consented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not consent_contact or consented_at is not null)
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  referred_by_person_id uuid not null references public.people(id) on delete restrict,
  referrer_note text not null default '' check (length(referrer_note) <= 1000),
  status text not null default 'new' check (status in ('new', 'under_review', 'in_care', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index referrals_person_created_at on public.referrals (person_id, created_at desc);

-- A Equipe 2 abre um caso manualmente; isso evita transformar recepção ou
-- indicação em acompanhamento automático.
create table public.care_cases (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid references public.visitors(id) on delete restrict,
  referral_id uuid references public.referrals(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'waiting', 'referred_to_cell', 'closed')),
  responsible_user_id uuid references public.app_users(id) on delete set null,
  next_step text not null default '' check (length(next_step) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((visitor_id is not null)::integer + (referral_id is not null)::integer = 1)
);

create unique index care_cases_one_visitor on public.care_cases (visitor_id) where visitor_id is not null;
create unique index care_cases_one_referral on public.care_cases (referral_id) where referral_id is not null;

create table public.care_records (
  id uuid primary key default gen_random_uuid(),
  care_case_id uuid not null references public.care_cases(id) on delete cascade,
  contact_type text not null default 'attempt' check (contact_type in ('attempt', 'contact', 'visit', 'other')),
  private_note text not null default '' check (length(private_note) <= 5000),
  next_step text not null default '' check (length(next_step) <= 1000),
  responsible_user_id uuid references public.app_users(id) on delete set null,
  created_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index care_records_case_created_at on public.care_records (care_case_id, created_at desc);

create table public.cell_referrals (
  id uuid primary key default gen_random_uuid(),
  care_case_id uuid not null references public.care_cases(id) on delete restrict,
  cell_id uuid not null references public.cells(id) on delete restrict,
  note_for_cell text not null default '' check (length(note_for_cell) <= 1000),
  referred_by_user_id uuid references public.app_users(id) on delete set null,
  delivery_status text not null default 'sent' check (delivery_status in ('sent', 'returned')),
  returned_at timestamptz,
  returned_by_user_id uuid references public.app_users(id) on delete set null,
  return_note text not null default '' check (length(return_note) <= 1000),
  created_at timestamptz not null default now(),
  check ((delivery_status = 'sent' and returned_at is null and returned_by_user_id is null)
    or (delivery_status = 'returned' and returned_at is not null and returned_by_user_id is not null))
);

create index cell_referrals_cell_created_at on public.cell_referrals (cell_id, created_at desc);

-- Devolução é um evento do encaminhamento: não altera automaticamente o caso
-- de cuidado nem redireciona a pessoa para outra célula.

create table public.cell_meetings (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null references public.cells(id) on delete restrict,
  meeting_date date not null,
  meeting_status text not null default 'scheduled' check (meeting_status in ('scheduled', 'completed', 'not_held')),
  not_held_note text not null default '' check (length(not_held_note) <= 2000),
  notes text not null default '' check (length(notes) <= 2000),
  created_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cell_id, meeting_date)
);

create table public.meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.cell_meetings(id) on delete cascade,
  person_id uuid references public.people(id) on delete restrict,
  visitor_id uuid references public.visitors(id) on delete restrict,
  attendance_status text not null default 'present' check (attendance_status in ('present', 'absent', 'excused')),
  recorded_at timestamptz not null default now(),
  check ((person_id is not null)::integer + (visitor_id is not null)::integer = 1)
);

create unique index meeting_attendance_person_once on public.meeting_attendance (meeting_id, person_id) where person_id is not null;
create unique index meeting_attendance_visitor_once on public.meeting_attendance (meeting_id, visitor_id) where visitor_id is not null;

create table public.meeting_photos (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.cell_meetings(id) on delete cascade,
  storage_bucket text not null default 'meeting-photos',
  storage_object_path text not null unique check (length(btrim(storage_object_path)) between 1 and 500),
  caption text not null default '' check (length(caption) <= 500),
  uploaded_by_user_id uuid references public.app_users(id) on delete set null,
  publication_status text not null default 'uploaded' check (publication_status in ('uploaded', 'published')),
  published_at timestamptz,
  published_by_user_id uuid references public.app_users(id) on delete set null,
  check ((publication_status = 'uploaded' and published_at is null and published_by_user_id is null)
    or (publication_status = 'published' and published_at is not null and published_by_user_id is not null)),
  created_at timestamptz not null default now()
);

-- A futura consulta da área do membro deve filtrar publication_status =
-- 'published'. Fotos apenas enviadas continuam disponíveis somente a rotas
-- autorizadas de liderança/secretaria.
create index meeting_photos_published_by_meeting
  on public.meeting_photos (meeting_id, created_at desc)
  where publication_status = 'published';

create table public.meeting_offerings (
  meeting_id uuid primary key references public.cell_meetings(id) on delete cascade,
  amount numeric(12,2) not null check (amount >= 0),
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  treasury_status text not null default 'pending' check (treasury_status in ('pending', 'sent', 'confirmed')),
  administrative_note text not null default '' check (length(administrative_note) <= 2000),
  sent_to_treasury_at timestamptz,
  sent_to_treasury_by_user_id uuid references public.app_users(id) on delete set null,
  recorded_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((treasury_status = 'pending' and sent_to_treasury_at is null and sent_to_treasury_by_user_id is null)
    or (treasury_status in ('sent', 'confirmed') and sent_to_treasury_at is not null and sent_to_treasury_by_user_id is not null))
);

-- A camada Node deverá registrar uma ação de auditoria ao alterar amount;
-- esta tabela preserva o valor atual e a observação administrativa opcional.

create table public.annual_themes (
  id uuid primary key default gen_random_uuid(),
  year smallint not null check (year between 2000 and 2100),
  title text not null check (length(btrim(title)) between 1 and 160),
  banner_storage_bucket text not null default 'annual-themes',
  banner_storage_path text not null check (length(btrim(banner_storage_path)) between 1 and 500),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year)
);

create unique index annual_themes_only_one_active
  on public.annual_themes (is_active)
  where is_active;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  kind text not null check (length(btrim(kind)) between 1 and 80),
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null default '' check (length(body) <= 1000),
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_unread_by_user on public.notifications (user_id, created_at desc) where read_at is null;

-- Metadados de auditoria servem apenas para contexto técnico não sensível.
-- A função também inspeciona objetos e listas aninhados.
create or replace function public.audit_metadata_is_safe(payload jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  item_key text;
  item_value jsonb;
  normalized_key text;
begin
  if jsonb_typeof(payload) = 'object' then
    for item_key, item_value in select key, value from jsonb_each(payload) loop
      normalized_key := lower(regexp_replace(item_key, '[^a-z0-9]', '', 'g'));
      if normalized_key in ('password', 'passwordhash', 'passwordsalt', 'token', 'tokenhash', 'privatenote') then
        return false;
      end if;
      if not public.audit_metadata_is_safe(item_value) then
        return false;
      end if;
    end loop;
  elsif jsonb_typeof(payload) = 'array' then
    for item_value in select value from jsonb_array_elements(payload) loop
      if not public.audit_metadata_is_safe(item_value) then
        return false;
      end if;
    end loop;
  end if;
  return true;
end;
$$;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.app_users(id) on delete set null,
  action text not null check (length(btrim(action)) between 1 and 100),
  entity_type text not null check (length(btrim(entity_type)) between 1 and 100),
  entity_id text,
  summary text not null check (length(btrim(summary)) between 1 and 1000),
  metadata jsonb not null default '{}'::jsonb check (public.audit_metadata_is_safe(metadata)),
  created_at timestamptz not null default now()
);

create index audit_logs_created_at on public.audit_logs (created_at desc);

-- Normalização no banco complementa (não substitui) a normalização da futura
-- camada Node. O valor persistido de WhatsApp contém somente dígitos.
create or replace function public.normalize_person_identifiers()
returns trigger
language plpgsql
as $$
declare
  raw_whatsapp text;
begin
  new.full_name := btrim(new.full_name);
  raw_whatsapp := btrim(coalesce(new.whatsapp, ''));
  new.whatsapp := regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g');
  if raw_whatsapp <> '' and new.whatsapp = '' then
    raise exception 'WhatsApp inválido';
  end if;
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  return new;
end;
$$;

create trigger people_normalize_identifiers
before insert or update of full_name, whatsapp, email on public.people
for each row execute function public.normalize_person_identifiers();

create or replace function public.normalize_cell_name()
returns trigger
language plpgsql
as $$
begin
  new.name := btrim(new.name);
  return new;
end;
$$;

create trigger cells_normalize_name
before insert or update of name on public.cells
for each row execute function public.normalize_cell_name();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger people_set_updated_at before update on public.people for each row execute function public.set_updated_at();
create trigger app_users_set_updated_at before update on public.app_users for each row execute function public.set_updated_at();
create trigger cells_set_updated_at before update on public.cells for each row execute function public.set_updated_at();
create trigger visitors_set_updated_at before update on public.visitors for each row execute function public.set_updated_at();
create trigger referrals_set_updated_at before update on public.referrals for each row execute function public.set_updated_at();
create trigger care_cases_set_updated_at before update on public.care_cases for each row execute function public.set_updated_at();
create trigger meeting_offerings_set_updated_at before update on public.meeting_offerings for each row execute function public.set_updated_at();
create trigger annual_themes_set_updated_at before update on public.annual_themes for each row execute function public.set_updated_at();

-- O estado atual do consentimento é derivado de um registro auditável. Uma
-- inserção inicial de pessoa parte sem consentimento; autorizar ou revogar
-- ocorre criando um registro em person_image_consent_records.
create or replace function public.prevent_unrecorded_image_consent_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and (new.image_consent or new.image_consented_at is not null) then
    raise exception 'Consentimento de imagem deve ser registrado em person_image_consent_records';
  end if;
  if tg_op = 'UPDATE' and pg_trigger_depth() = 1
    and (new.image_consent is distinct from old.image_consent or new.image_consented_at is distinct from old.image_consented_at) then
    raise exception 'Consentimento de imagem deve ser alterado por registro auditável';
  end if;
  return new;
end;
$$;

create trigger people_require_image_consent_record
before insert or update of image_consent, image_consented_at on public.people
for each row execute function public.prevent_unrecorded_image_consent_change();

create or replace function public.sync_person_image_consent()
returns trigger
language plpgsql
as $$
begin
  update public.people
  set image_consent = new.authorized,
      image_consented_at = case when new.authorized then new.recorded_at else null end
  where id = new.person_id;
  return new;
end;
$$;

create trigger person_image_consent_records_sync_person
after insert on public.person_image_consent_records
for each row execute function public.sync_person_image_consent();

-- Um encaminhamento novo somente pode ser enviado manualmente para uma célula
-- ativa. Encaminhamentos históricos não são removidos quando a célula inativa.
create or replace function public.ensure_active_referral_cell()
returns trigger
language plpgsql
as $$
declare
  target_is_active boolean;
begin
  select is_active into target_is_active from public.cells where id = new.cell_id for share;
  if target_is_active is distinct from true then
    raise exception 'Célula indisponível para novos encaminhamentos';
  end if;
  return new;
end;
$$;

create trigger cell_referrals_require_active_cell
before insert or update of cell_id on public.cell_referrals
for each row execute function public.ensure_active_referral_cell();

-- Vínculos administrativos continuam independentes da membresia. Quando a
-- pessoa já possui conta, o papel correspondente precisa existir; pessoa sem
-- conta pode ser preparada para a função sem receber acesso automaticamente.
create or replace function public.ensure_person_role_when_user_exists(required_person_id uuid, required_role text)
returns void
language plpgsql
as $$
declare
  linked_user_id uuid;
begin
  select id into linked_user_id from public.app_users where person_id = required_person_id;
  if linked_user_id is not null and not exists (
    select 1 from public.user_roles where user_id = linked_user_id and role_code = required_role
  ) then
    raise exception 'A pessoa vinculada já possui conta e precisa do papel %', required_role;
  end if;
end;
$$;

create or replace function public.ensure_leadership_role()
returns trigger
language plpgsql
as $$
begin
  perform public.ensure_person_role_when_user_exists(new.person_id, 'leader');
  return new;
end;
$$;

create trigger cell_leaderships_require_leader_role
before insert or update of person_id on public.cell_leaderships
for each row execute function public.ensure_leadership_role();

create or replace function public.ensure_secretary_role()
returns trigger
language plpgsql
as $$
begin
  perform public.ensure_person_role_when_user_exists(new.person_id, 'secretary');
  return new;
end;
$$;

create trigger cell_secretaries_require_secretary_role
before insert or update of person_id on public.cell_secretaries
for each row execute function public.ensure_secretary_role();

create or replace function public.ensure_supervisor_scope_role()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.user_roles where user_id = new.user_id and role_code = 'supervisor') then
    raise exception 'O usuário precisa do papel supervisor para receber escopo';
  end if;
  return new;
end;
$$;

create trigger supervisor_scopes_require_supervisor_role
before insert or update of user_id on public.supervisor_cell_scopes
for each row execute function public.ensure_supervisor_scope_role();

create or replace function public.prevent_required_role_removal()
returns trigger
language plpgsql
as $$
begin
  if old.role_code = 'supervisor' and exists (select 1 from public.supervisor_cell_scopes where user_id = old.user_id) then
    raise exception 'Remova o escopo de Supervisor antes de remover o papel';
  end if;
  if old.role_code = 'leader' and exists (
    select 1 from public.cell_leaderships leadership
    join public.app_users users on users.person_id = leadership.person_id
    where users.id = old.user_id and leadership.ended_at is null
  ) then
    raise exception 'Remova a liderança ativa antes de remover o papel';
  end if;
  if old.role_code = 'secretary' and exists (
    select 1 from public.cell_secretaries secretary
    join public.app_users users on users.person_id = secretary.person_id
    where users.id = old.user_id and secretary.ended_at is null
  ) then
    raise exception 'Remova a secretaria ativa antes de remover o papel';
  end if;
  return old;
end;
$$;

create trigger user_roles_prevent_required_role_removal
before delete or update of role_code on public.user_roles
for each row execute function public.prevent_required_role_removal();

insert into public.roles (code, name, description) values
  ('member', 'Membro', 'Acesso pessoal e indicação.'),
  ('leader', 'Líder de célula', 'Acompanha a própria célula e encaminhamentos recebidos.'),
  ('welcome1', 'Equipe 1 — Boas-Vindas', 'Recepção e confirmação de cadastro.'),
  ('welcome2', 'Equipe 2 — Boas-Vindas', 'Acompanhamento e decisões de cuidado.'),
  ('supervisor', 'Supervisor', 'Acompanhamento operacional dentro do escopo atribuído.'),
  ('pastor', 'Pastor', 'Acompanhamento pastoral conforme permissões futuras.'),
  ('secretary', 'Secretaria', 'Apoio administrativo e de célula conforme permissões futuras.'),
  ('admin', 'Administrador', 'Administração de usuários, células e estrutura.')
on conflict (code) do update set name = excluded.name, description = excluded.description;

insert into public.formation_modules (code, name, description, display_order) values
  ('integration', 'Integração', 'Formação inicial de integração.', 10),
  ('m1_leadership_course', 'M1 — Curso de Liderança', 'Curso de formação de liderança.', 20),
  ('m2_encounter_with_god', 'M2 — Encontro com Deus', 'Etapa de formação espiritual.', 30)
on conflict (code) do update set name = excluded.name, description = excluded.description, display_order = excluded.display_order;

-- Não há políticas nesta primeira etapa porque o frontend ainda não acessa
-- Supabase diretamente. RLS fica habilitada por padrão: nenhum cliente anônimo
-- deve ler ou escrever dados ministeriais antes da futura camada de autorização.
alter table public.people enable row level security;
alter table public.app_users enable row level security;
alter table public.person_image_consent_records enable row level security;
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.app_sessions enable row level security;
alter table public.cells enable row level security;
alter table public.cell_memberships enable row level security;
alter table public.cell_leaderships enable row level security;
alter table public.cell_secretaries enable row level security;
alter table public.supervisor_cell_scopes enable row level security;
alter table public.formation_modules enable row level security;
alter table public.person_formation_completions enable row level security;
alter table public.visitors enable row level security;
alter table public.referrals enable row level security;
alter table public.care_cases enable row level security;
alter table public.care_records enable row level security;
alter table public.cell_referrals enable row level security;
alter table public.cell_meetings enable row level security;
alter table public.meeting_attendance enable row level security;
alter table public.meeting_photos enable row level security;
alter table public.meeting_offerings enable row level security;
alter table public.annual_themes enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
