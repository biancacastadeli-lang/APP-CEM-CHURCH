-- Horário histórico de cada reunião. Permanece opcional para preservar
-- compatibilidade com eventuais registros anteriores sem inventar valores.
alter table public.cell_meetings
  add column meeting_time time null;
