-- Data de nascimento é opcional. Não há preenchimento retroativo nem valor padrão.
alter table public.people
  add column birth_date date null;
