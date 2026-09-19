-- Complementos da primeira migration já aplicada. Esta migration não cria
-- pessoas, células, usuários ou qualquer registro demonstrativo.

-- `completed` foi o nome provisório do primeiro schema. Preserva registros
-- existentes e passa a expor o vocabulário aprovado: scheduled, held, not_held.
update public.cell_meetings
set meeting_status = 'held'
where meeting_status = 'completed';

alter table public.cell_meetings
  drop constraint if exists cell_meetings_meeting_status_check;

alter table public.cell_meetings
  add constraint cell_meetings_meeting_status_check
  check (meeting_status in ('scheduled', 'held', 'not_held'));

-- Histórico imutável de mudanças de situação. A camada Node poderá registrar
-- também eventos de integração e membresia na mesma transação de negócio.
-- Não contém notas privadas de cuidado.
create table public.person_status_history (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  source_type text not null check (source_type in ('visitor', 'referral', 'care_case', 'integration', 'membership', 'manual')),
  previous_status text check (length(btrim(previous_status)) between 1 and 80),
  current_status text not null check (length(btrim(current_status)) between 1 and 80),
  changed_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index person_status_history_person_created_at
  on public.person_status_history (person_id, created_at desc);

create or replace function public.record_visitor_status_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.reception_status is distinct from old.reception_status then
    insert into public.person_status_history (person_id, source_type, previous_status, current_status)
    values (new.person_id, 'visitor', case when tg_op = 'INSERT' then null else old.reception_status end, new.reception_status);
  end if;
  return new;
end;
$$;

create trigger visitors_record_status_history
after insert or update of reception_status on public.visitors
for each row execute function public.record_visitor_status_history();

create or replace function public.record_referral_status_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.person_status_history (person_id, source_type, previous_status, current_status)
    values (new.person_id, 'referral', case when tg_op = 'INSERT' then null else old.status end, new.status);
  end if;
  return new;
end;
$$;

create trigger referrals_record_status_history
after insert or update of status on public.referrals
for each row execute function public.record_referral_status_history();

create or replace function public.record_care_case_status_history()
returns trigger
language plpgsql
as $$
declare
  subject_person_id uuid;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    select coalesce(visitor.person_id, referral.person_id)
      into subject_person_id
      from public.care_cases care
      left join public.visitors visitor on visitor.id = care.visitor_id
      left join public.referrals referral on referral.id = care.referral_id
     where care.id = new.id;

    if subject_person_id is not null then
      insert into public.person_status_history (person_id, source_type, previous_status, current_status)
      values (subject_person_id, 'care_case', case when tg_op = 'INSERT' then null else old.status end, new.status);
    end if;
  end if;
  return new;
end;
$$;

create trigger care_cases_record_status_history
after insert or update of status on public.care_cases
for each row execute function public.record_care_case_status_history();

-- A oferta mantém o valor atual; suas correções ganham trilha própria, sem
-- registrar qualquer dado de autenticação. A futura camada Node deve inserir
-- este evento na mesma transação que alterar o valor.
create table public.meeting_offering_adjustments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.cell_meetings(id) on delete cascade,
  previous_amount numeric(12,2) not null check (previous_amount >= 0),
  corrected_amount numeric(12,2) not null check (corrected_amount >= 0),
  administrative_note text not null default '' check (length(administrative_note) <= 2000),
  changed_by_user_id uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (previous_amount is distinct from corrected_amount)
);

create index meeting_offering_adjustments_meeting_created_at
  on public.meeting_offering_adjustments (meeting_id, created_at desc);

-- Somente uma pessoa com liderança ou secretaria ativa da célula da reunião
-- pode enviar uma foto. Publicar exige liderança ativa; assim a área de membro
-- poderá consultar apenas fotos published sem confiar em uma marca livre.
create or replace function public.ensure_meeting_photo_uploader_is_authorized()
returns trigger
language plpgsql
as $$
begin
  if new.uploaded_by_user_id is null or not exists (
    select 1
      from public.cell_meetings meeting
      join public.app_users uploader on uploader.id = new.uploaded_by_user_id
      left join public.cell_leaderships leadership
        on leadership.cell_id = meeting.cell_id
       and leadership.person_id = uploader.person_id
       and leadership.ended_at is null
      left join public.cell_secretaries secretary
        on secretary.cell_id = meeting.cell_id
       and secretary.person_id = uploader.person_id
       and secretary.ended_at is null
     where meeting.id = new.meeting_id
       and (leadership.id is not null or secretary.id is not null)
  ) then
    raise exception 'Somente liderança ou secretaria ativa da célula pode enviar fotos';
  end if;
  return new;
end;
$$;

create trigger meeting_photos_require_authorized_uploader
before insert or update of meeting_id, uploaded_by_user_id on public.meeting_photos
for each row execute function public.ensure_meeting_photo_uploader_is_authorized();

create or replace function public.ensure_meeting_photo_publisher_is_leader()
returns trigger
language plpgsql
as $$
begin
  if new.publication_status = 'published' and (
    new.published_by_user_id is null or not exists (
      select 1
        from public.cell_meetings meeting
        join public.app_users publisher on publisher.id = new.published_by_user_id
        join public.cell_leaderships leadership
          on leadership.cell_id = meeting.cell_id
         and leadership.person_id = publisher.person_id
         and leadership.ended_at is null
       where meeting.id = new.meeting_id
    )
  ) then
    raise exception 'Somente liderança ativa da célula pode publicar fotos para membros';
  end if;
  return new;
end;
$$;

create trigger meeting_photos_require_leader_publication
before insert or update of meeting_id, publication_status, published_by_user_id on public.meeting_photos
for each row execute function public.ensure_meeting_photo_publisher_is_leader();

-- `private_note` continua exclusivamente em care_records. A camada Node nunca
-- deve copiá-la para cell_referrals.note_for_cell, que é compartilhável.

alter table public.person_status_history enable row level security;
alter table public.meeting_offering_adjustments enable row level security;

-- Não há policies nesta migration: acesso permanece fechado até a camada Node
-- aplicar autorização por rota e, futuramente, policies específicas.
