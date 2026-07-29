-- LINGKOD Meneses - one-shot diagnostic for the six notification triggers
-- (announcements/submissions/officers/requests/feedback/account-changes).
-- Read-only, changes nothing - safe to run any time.
--
-- Checks every column each trigger function actually reads or writes, so
-- an unexpected type (the same root cause as the notifications.type
-- enum bug) shows up here instead of as a runtime error the next time
-- someone posts an announcement, submits a request, etc.

select 'notifications' as table_name, column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'notifications'
  and column_name in ('recipient_id','type','title','body','link_url','read_at','created_at')

union all
select 'announcements', column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'announcements'
  and column_name in ('visibility','organization','is_published','created_by','title','content')

union all
select 'submissions', column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'submissions'
  and column_name in ('status','submitted_by','document_title','remarks')

union all
select 'organization_officers', column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'organization_officers'
  and column_name in ('organization_id','full_name','position')

union all
select 'requests', column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'requests'
  and column_name in ('status','user_id','request_type','remarks','full_name')

union all
select 'feedback', column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'feedback'
  and column_name in ('status','user_id','feedback_type','full_name')

union all
select 'profiles', column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles'
  and column_name in ('role','status','organization','organization_id','full_name')

order by table_name, column_name;

-- Expect: uuid columns show data_type=uuid; every text-ish column
-- (title/body/link_url/type/full_name/status/etc.) shows data_type=text
-- (not "character varying" and not "USER-DEFINED"). "USER-DEFINED" in
-- udt_name means it's still an enum somewhere - the same bug class as
-- notifications.type, needing the same alter-column-to-text fix applied
-- to that specific column.

-- Also confirms every trigger actually exists and is enabled:
select trigger_name, event_object_table, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
    'trg_notify_on_announcement',
    'trg_notify_on_submission_change',
    'trg_notify_on_officer_change',
    'trg_notify_on_request_change',
    'trg_notify_on_feedback_change',
    'trg_notify_on_account_change'
  )
order by event_object_table;
