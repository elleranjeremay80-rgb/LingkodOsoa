-- LINGKOD Meneses - fix "Couldn't remove this message." for Remove for
-- Everyone.
--
-- messages_not_empty (an untracked constraint - never appears anywhere
-- in this migrations folder, same "created directly against the live
-- project" gap as several other objects this session) requires every
-- message to have non-empty content OR a file_path. It predates the
-- remove-for-everyone feature entirely, so it was never written to
-- allow the one legitimate case where a message needs BOTH cleared at
-- once: removeMessageForEveryone() (see messages/script.js) blanks
-- content/file_name/file_path/file_type/file_size/storage_bucket
-- together, specifically so the original content is no longer
-- accessible - exactly what "remove for everyone" is supposed to do,
-- and exactly what this constraint was rejecting.
--
-- Re-added with the same original intent (a normal message must have
-- real content or a file) plus one exception: a message already marked
-- removed_for_everyone is allowed to have neither, since blanking both
-- is the whole point of that state, not a data-integrity violation.

alter table public.messages drop constraint if exists messages_not_empty;
alter table public.messages add constraint messages_not_empty
  check (
    removed_for_everyone = true
    or coalesce(nullif(trim(both from content), ''), '') <> ''
    or file_path is not null
  );

notify pgrst, 'reload schema';
