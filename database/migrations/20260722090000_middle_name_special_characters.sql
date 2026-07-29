-- LINGKOD Meneses - Middle Name now additionally allows periods and
-- commas client-side (e.g. middle initials like "D.") - the database
-- constraint has to widen the same way, or a value the client accepts
-- would still be rejected at save time with a raw constraint-violation
-- error instead of the friendly inline message.

alter table public.profiles drop constraint if exists profiles_middle_name_format;
alter table public.profiles add constraint profiles_middle_name_format
  check (middle_name = '' or middle_name ~ '^[A-Za-z'' .,-]+$') not valid;

notify pgrst, 'reload schema';
