-- Estrutura organizacional do CEM CONNECT.
-- Esta migration não cria pessoas, células, usuários, credenciais ou vínculos
-- ministeriais fictícios. Os quatro ministérios abaixo são dados estruturais.

create table public.ministries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ministries_name_normalized_unique
  on public.ministries (lower(btrim(name)));

-- A coluna permanece nula para não atribuir um ministério incorreto às células
-- existentes. A camada Node exige ministry_id em novas criações e edições.
alter table public.cells add column ministry_id uuid references public.ministries(id) on delete restrict;
create index cells_ministry_id_active on public.cells (ministry_id, is_active);

-- Supervisor é uma atribuição organizacional de uma pessoa; não cria login.
create table public.ministry_supervisor_assignments (
  id uuid primary key default gen_random_uuid(),
  ministry_id uuid not null references public.ministries(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index ministry_supervisors_one_active_assignment
  on public.ministry_supervisor_assignments (ministry_id, person_id)
  where ended_at is null;
create index ministry_supervisors_person_active
  on public.ministry_supervisor_assignments (person_id)
  where ended_at is null;

-- Uma célula pode ter um supervisor organizacional ativo. O escopo de acesso
-- existente (supervisor_cell_scopes) continua para contas que já possuem login.
create table public.cell_supervisor_assignments (
  id uuid primary key default gen_random_uuid(),
  cell_id uuid not null references public.cells(id) on delete restrict,
  person_id uuid not null references public.people(id) on delete restrict,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index cell_supervisors_one_active_assignment
  on public.cell_supervisor_assignments (cell_id)
  where ended_at is null;
create unique index cell_supervisors_one_active_person_cell
  on public.cell_supervisor_assignments (cell_id, person_id)
  where ended_at is null;
create index cell_supervisors_person_active
  on public.cell_supervisor_assignments (person_id)
  where ended_at is null;

-- Não permita associar uma célula a alguém que não seja Supervisor ativo do
-- mesmo ministério. A aplicação deve definir o ministério primeiro.
create or replace function public.ensure_cell_supervisor_assignment_is_consistent()
returns trigger
language plpgsql
as $$
declare
  cell_ministry_id uuid;
begin
  select ministry_id into cell_ministry_id
    from public.cells where id = new.cell_id;
  if cell_ministry_id is null then
    raise exception 'A célula precisa possuir ministério antes de receber Supervisor';
  end if;
  if not exists (
    select 1
      from public.ministry_supervisor_assignments assignments
     where assignments.ministry_id = cell_ministry_id
       and assignments.person_id = new.person_id
       and assignments.ended_at is null
  ) then
    raise exception 'A pessoa precisa ser Supervisor ativo do ministério da célula';
  end if;
  return new;
end;
$$;

create trigger cell_supervisors_validate_ministry
before insert or update of cell_id, person_id on public.cell_supervisor_assignments
for each row execute function public.ensure_cell_supervisor_assignment_is_consistent();

-- A relação técnica permite mais de um líder ativo (por exemplo, casal), sem
-- duplicar a mesma pessoa na mesma célula.
drop index public.cell_leaderships_one_current_leader;
create unique index cell_leaderships_one_active_person_per_cell
  on public.cell_leaderships (cell_id, person_id)
  where ended_at is null;

-- Liderança organizacional não cria nem exige credencial. Se a pessoa possuir
-- conta, o acesso ao painel continua dependente de user_roles e pode ser
-- concedido ou revogado separadamente da liderança.
create or replace function public.ensure_leadership_role()
returns trigger
language plpgsql
as $$
begin
  return new;
end;
$$;

create or replace function public.prevent_required_role_removal()
returns trigger
language plpgsql
as $$
begin
  if old.role_code = 'supervisor' and exists (
    select 1 from public.supervisor_cell_scopes where user_id = old.user_id
  ) then
    raise exception 'Remova o escopo de Supervisor antes de remover o papel';
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

create trigger ministries_set_updated_at
before update on public.ministries
for each row execute function public.set_updated_at();
create trigger ministry_supervisor_assignments_set_updated_at
before update on public.ministry_supervisor_assignments
for each row execute function public.set_updated_at();
create trigger cell_supervisor_assignments_set_updated_at
before update on public.cell_supervisor_assignments
for each row execute function public.set_updated_at();

insert into public.ministries (name) values
  ('Família'),
  ('Jovens'),
  ('Mulheres'),
  ('Kids')
on conflict (lower(btrim(name))) do nothing;

alter table public.ministries enable row level security;
alter table public.ministry_supervisor_assignments enable row level security;
alter table public.cell_supervisor_assignments enable row level security;

-- Sem policies nesta etapa. A camada Node continua aplicando autorização por
-- rota; o frontend não acessa estas tabelas diretamente.
