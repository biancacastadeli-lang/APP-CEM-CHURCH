-- Dados complementares de Pessoas e funções ministeriais sem autenticação.
-- Esta migration não cria pessoas, células, usuários ou atribuições fictícias.

alter table public.people
  add column sex text,
  add column postal_code text,
  add column address_line text,
  add column address_number text,
  add column address_complement text,
  add column neighborhood text,
  add column city text,
  add column state text,
  add column person_status text;

alter table public.people
  add constraint people_sex_check
    check (sex is null or sex in ('female', 'male')),
  add constraint people_postal_code_check
    check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  add constraint people_address_line_check
    check (address_line is null or length(btrim(address_line)) between 1 and 180),
  add constraint people_address_number_check
    check (address_number is null or length(btrim(address_number)) between 1 and 20),
  add constraint people_address_complement_check
    check (address_complement is null or length(btrim(address_complement)) between 1 and 120),
  add constraint people_neighborhood_check
    check (neighborhood is null or length(btrim(neighborhood)) between 1 and 100),
  add constraint people_city_check
    check (city is null or length(btrim(city)) between 1 and 100),
  add constraint people_state_check
    check (state is null or state ~ '^[A-Z]{2}$'),
  add constraint people_person_status_check
    check (person_status is null or person_status in ('member', 'visitor', 'integrating', 'inactive', 'transferred'));

-- O cadastro interno exige WhatsApp. O preflight desta migration confirma que
-- nenhum registro existente precisa receber valor artificial.
alter table public.people
  alter column whatsapp drop default,
  drop constraint people_whatsapp_check,
  add constraint people_whatsapp_check check (whatsapp ~ '^[0-9]{10,13}$');

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
  new.sex := nullif(lower(btrim(coalesce(new.sex, ''))), '');
  new.postal_code := nullif(regexp_replace(coalesce(new.postal_code, ''), '\D', '', 'g'), '');
  new.address_line := nullif(btrim(coalesce(new.address_line, '')), '');
  new.address_number := nullif(btrim(coalesce(new.address_number, '')), '');
  new.address_complement := nullif(btrim(coalesce(new.address_complement, '')), '');
  new.neighborhood := nullif(btrim(coalesce(new.neighborhood, '')), '');
  new.city := nullif(btrim(coalesce(new.city, '')), '');
  new.state := nullif(upper(btrim(coalesce(new.state, ''))), '');
  new.person_status := nullif(lower(btrim(coalesce(new.person_status, ''))), '');
  return new;
end;
$$;

drop trigger people_normalize_identifiers on public.people;
create trigger people_normalize_identifiers
before insert or update of full_name, whatsapp, email, sex, postal_code, address_line, address_number, address_complement, neighborhood, city, state, person_status
on public.people
for each row execute function public.normalize_person_identifiers();

-- O status pode começar vazio para não inventar informação em cadastros
-- existentes, mas não pode ser apagado depois de definido: use inactive ou
-- transferred para registrar a transição real.
create or replace function public.prevent_person_status_clearing()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.person_status is not null and new.person_status is null then
    raise exception 'A situação da pessoa não pode ser apagada; informe uma situação válida';
  end if;
  return new;
end;
$$;

create trigger people_prevent_person_status_clearing
before update of person_status on public.people
for each row execute function public.prevent_person_status_clearing();

alter table public.person_status_history
  drop constraint person_status_history_source_type_check,
  add constraint person_status_history_source_type_check
    check (source_type in ('visitor', 'referral', 'care_case', 'integration', 'membership', 'manual', 'person'));

create or replace function public.record_person_status_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.person_status is not null then
    insert into public.person_status_history (person_id, source_type, previous_status, current_status)
    values (new.id, 'person', null, new.person_status);
  elsif tg_op = 'UPDATE' and new.person_status is distinct from old.person_status then
    insert into public.person_status_history (person_id, source_type, previous_status, current_status)
    values (new.id, 'person', old.person_status, new.person_status);
  end if;
  return new;
end;
$$;

create trigger people_record_person_status_history
after insert or update of person_status on public.people
for each row execute function public.record_person_status_history();

create table public.ministry_functions (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null unique check (length(btrim(name)) between 1 and 100),
  scope_type text not null check (scope_type in ('church', 'cell')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.person_ministry_assignments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  ministry_function_code text not null references public.ministry_functions(code) on delete restrict,
  cell_id uuid references public.cells(id) on delete restrict,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index person_ministry_assignments_one_active_cell_scope
  on public.person_ministry_assignments (person_id, ministry_function_code, cell_id)
  where ended_at is null and cell_id is not null;

create unique index person_ministry_assignments_one_active_church_scope
  on public.person_ministry_assignments (person_id, ministry_function_code)
  where ended_at is null and cell_id is null;

create or replace function public.ensure_ministry_assignment_scope()
returns trigger
language plpgsql
as $$
declare
  function_scope text;
  function_active boolean;
begin
  select scope_type, is_active
    into function_scope, function_active
    from public.ministry_functions
   where code = new.ministry_function_code;

  if function_scope is null then
    raise exception 'Função ministerial inválida';
  end if;
  if not function_active then
    raise exception 'Função ministerial inativa não pode receber nova atribuição';
  end if;
  if function_scope = 'cell' and new.cell_id is null then
    raise exception 'Função de célula exige uma célula';
  end if;
  if function_scope = 'church' and new.cell_id is not null then
    raise exception 'Função de igreja não pode ser vinculada a uma célula';
  end if;
  return new;
end;
$$;

create trigger person_ministry_assignments_validate_scope
before insert or update of ministry_function_code, cell_id
on public.person_ministry_assignments
for each row execute function public.ensure_ministry_assignment_scope();

create trigger ministry_functions_set_updated_at
before update on public.ministry_functions
for each row execute function public.set_updated_at();

create trigger person_ministry_assignments_set_updated_at
before update on public.person_ministry_assignments
for each row execute function public.set_updated_at();

insert into public.ministry_functions (code, name, scope_type) values
  ('host', 'Anfitrião', 'cell'),
  ('social_assistant', 'Assistente Social', 'cell'),
  ('treasurer', 'Tesoureiro', 'church')
on conflict (code) do update
  set name = excluded.name,
      scope_type = excluded.scope_type;

alter table public.ministry_functions enable row level security;
alter table public.person_ministry_assignments enable row level security;

-- Sem policies nesta etapa: a futura camada Node aplica autorização por rota.
