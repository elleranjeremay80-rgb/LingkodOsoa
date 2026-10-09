-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.LINGKOD (
  Student_Number bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  full_name text DEFAULT ''::text,
  department character varying DEFAULT ''::character varying,
  student_organization_name text DEFAULT ''::text,
  position_in_the_student_organization character varying DEFAULT ''::character varying,
  email_address character varying DEFAULT ''::character varying,
  password character varying DEFAULT ''::character varying,
  CONSTRAINT LINGKOD_pkey PRIMARY KEY (Student_Number)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  student_number text DEFAULT ''::text CHECK (student_number IS NULL OR student_number ~ '^[0-9]{10}$'::text) NOT VALI),
  department text,
  organization text,
  position text CHECK ("position" IS NOT NULL AND "position" <> ''::text) NOT VALI),
  email text NOT NULL,
  role USER-DEFINED NOT NULL DEFAULT 'student'::user_role,
  profile_picture_url text,
  status USER-DEFINED NOT NULL DEFAULT 'active'::profile_status,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  department_id uuid CHECK (department_id IS NOT NULL) NOT VALI),
  organization_id uuid CHECK (organization_id IS NOT NULL) NOT VALI),
  last_name text CHECK (last_name = ''::text OR last_name ~ '^[A-Za-z'' -]+$'::text) NOT VALI),
  first_name text CHECK (first_name = ''::text OR first_name ~ '^[A-Za-z'' -]+$'::text) NOT VALI),
  middle_name text CHECK (middle_name = ''::text OR middle_name ~ '^[A-Za-z'' .,-]+$'::text) NOT VALI),
  full_name text DEFAULT TRIM(BOTH ', '::text FROM (((COALESCE(NULLIF(last_name, ''::text), ''::text) || ', '::text) || COALESCE(NULLIF(first_name, ''::text), ''::text)) ||
CASE
    WHEN (NULLIF(middle_name, ''::text) IS NOT NULL) THEN (' '::text || middle_name)
    ELSE ''::text
END)),
  avatar_url text,
  bio text,
  username text CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_.]{4,30}$'::text) NOT VALI),
  contact_number text CHECK (contact_number IS NULL OR contact_number ~ '^(09\d{9}|\+639\d{9})$'::text) NOT VALI),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id),
  CONSTRAINT profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.announcements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  image_url text,
  visibility USER-DEFINED NOT NULL DEFAULT 'public'::visibility_type,
  organization text,
  is_published boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  event_date date,
  event_location text,
  event_who text,
  CONSTRAINT announcements_pkey PRIMARY KEY (id),
  CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.calendar_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  event_date date NOT NULL,
  event_time time without time zone,
  venue text,
  organizer text,
  organization text,
  visibility USER-DEFINED NOT NULL DEFAULT 'public'::visibility_type,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_pkey PRIMARY KEY (id),
  CONSTRAINT calendar_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.projects_activities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category USER-DEFINED NOT NULL,
  title text NOT NULL,
  description text,
  organization text NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'planned'::project_status,
  start_date date,
  end_date date,
  venue text,
  price numeric CHECK (price >= 0::numeric),
  outcome_summary text,
  image_url text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  implementation_date date,
  who_can_avail ARRAY CHECK (who_can_avail IS NULL OR who_can_avail <@ ARRAY['Students'::text, 'Faculty'::text, 'Alumni'::text, 'Public'::text, 'Everyone'::text]),
  CONSTRAINT projects_activities_pkey PRIMARY KEY (id),
  CONSTRAINT projects_activities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.repository_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category USER-DEFINED NOT NULL DEFAULT 'other'::file_category,
  organization text,
  description text,
  is_public boolean NOT NULL DEFAULT true,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint CHECK (file_size >= 0),
  file_type text,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  file_path text,
  recipient_type text NOT NULL DEFAULT 'public'::text CHECK (recipient_type = ANY (ARRAY['public'::text, 'osoa_eb'::text, 'org_presidents'::text, 'specific_organization'::text, 'multiple_organizations'::text])),
  recipient_organization_id uuid,
  recipient_organization_ids ARRAY,
  updated_by uuid,
  CONSTRAINT repository_files_pkey PRIMARY KEY (id),
  CONSTRAINT repository_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id),
  CONSTRAINT repository_files_recipient_organization_id_fkey FOREIGN KEY (recipient_organization_id) REFERENCES public.organizations(id),
  CONSTRAINT repository_files_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  submitted_by uuid,
  organization text,
  document_title text NOT NULL,
  category USER-DEFINED NOT NULL DEFAULT 'other'::file_category,
  file_url text,
  status USER-DEFINED NOT NULL DEFAULT 'pending'::approval_status,
  remarks text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  reviewer_id uuid,
  approved_at timestamp with time zone,
  rejected_at timestamp with time zone,
  file_name text,
  file_path text,
  storage_bucket text DEFAULT 'submission-documents'::text,
  file_type text,
  file_size bigint,
  uploaded_at timestamp with time zone,
  specified_type text,
  CONSTRAINT submissions_pkey PRIMARY KEY (id),
  CONSTRAINT submissions_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id),
  CONSTRAINT submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id),
  CONSTRAINT submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  organization text,
  request_type text NOT NULL,
  request_description text,
  attachment_url text,
  status USER-DEFINED NOT NULL DEFAULT 'pending'::approval_status,
  remarks text,
  approved_by uuid,
  approved_date timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  request_id text NOT NULL UNIQUE,
  full_name text,
  student_number text,
  specified_type text,
  organization_id uuid,
  assigned_to_role text NOT NULL DEFAULT 'osoa_eb'::text CHECK (assigned_to_role = ANY (ARRAY['osoa_eb'::text, 'org_president'::text])),
  assigned_organization_id uuid,
  updated_by uuid,
  CONSTRAINT requests_pkey PRIMARY KEY (id),
  CONSTRAINT requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT requests_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id),
  CONSTRAINT requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT requests_assigned_organization_id_fkey FOREIGN KEY (assigned_organization_id) REFERENCES public.organizations(id),
  CONSTRAINT requests_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  feedback_type USER-DEFINED NOT NULL DEFAULT 'comment'::feedback_category,
  feedback_message text NOT NULL,
  status USER-DEFINED NOT NULL DEFAULT 'new'::feedback_status,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  feedback_id text NOT NULL UNIQUE,
  full_name text,
  email text,
  specified_type text,
  rating smallint NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
  organization text,
  organization_id uuid,
  updated_by uuid,
  CONSTRAINT feedback_pkey PRIMARY KEY (id),
  CONSTRAINT feedback_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT feedback_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id),
  CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT feedback_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  title text,
  message text,
  type text,
  link_url text,
  is_read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  recipient_id uuid,
  body text,
  read_at timestamp with time zone,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  type USER-DEFINED NOT NULL DEFAULT 'direct'::conversation_type,
  name text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  last_message_content text,
  last_message_at timestamp with time zone,
  last_message_sender_id uuid,
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id),
  CONSTRAINT conversations_last_message_sender_id_fkey FOREIGN KEY (last_message_sender_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.conversation_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  last_read_at timestamp with time zone,
  CONSTRAINT conversation_members_pkey PRIMARY KEY (id),
  CONSTRAINT conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT conversation_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid,
  content text,
  attachment_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  is_read boolean NOT NULL DEFAULT false,
  file_name text,
  file_path text,
  file_type text,
  file_size bigint,
  storage_bucket text,
  forwarded_from_message_id uuid,
  removed_for_everyone boolean NOT NULL DEFAULT false,
  removed_by uuid,
  removed_at timestamp with time zone,
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT messages_forwarded_from_message_id_fkey FOREIGN KEY (forwarded_from_message_id) REFERENCES public.messages(id),
  CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.profiles(id),
  CONSTRAINT messages_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.departments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  CONSTRAINT departments_pkey PRIMARY KEY (id)
);
CREATE TABLE public.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  logo_url text,
  description text,
  theme_color text,
  vision text,
  mission text,
  goals text,
  acronym text,
  category text CHECK (category IS NULL OR (category = ANY (ARRAY['Academic'::text, 'Civic'::text, 'Religious'::text, 'Sports'::text, 'Cultural'::text, 'Special Interest'::text]))),
  president_name text,
  adviser text,
  member_count integer CHECK (member_count IS NULL OR member_count > 0),
  facebook_url text CHECK (facebook_url IS NULL OR facebook_url ~* '^https?://(www\.|m\.)?(facebook|fb)\.com/'::text),
  instagram_url text CHECK (instagram_url IS NULL OR instagram_url ~* '^https?://'::text),
  twitter_url text CHECK (twitter_url IS NULL OR twitter_url ~* '^https?://'::text),
  tiktok_url text CHECK (tiktok_url IS NULL OR tiktok_url ~* '^https?://'::text),
  website_url text CHECK (website_url IS NULL OR website_url ~* '^https?://'::text),
  updated_at timestamp with time zone,
  updated_by uuid,
  CONSTRAINT organizations_pkey PRIMARY KEY (id),
  CONSTRAINT organizations_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_settings (
  user_id uuid NOT NULL,
  email_notifications boolean NOT NULL DEFAULT true,
  sms_notifications boolean NOT NULL DEFAULT false,
  dark_mode boolean NOT NULL DEFAULT false,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  show_profile_information boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.feedback_id_counters (
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  CONSTRAINT feedback_id_counters_pkey PRIMARY KEY (year)
);
CREATE TABLE public.request_id_counters (
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  CONSTRAINT request_id_counters_pkey PRIMARY KEY (year)
);
CREATE TABLE public.emoji_usage (
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT emoji_usage_pkey PRIMARY KEY (user_id, emoji),
  CONSTRAINT emoji_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.organization_positions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  position_name text NOT NULL,
  system_role text NOT NULL CHECK (system_role = ANY (ARRAY['osoa_eb'::text, 'org_president'::text, 'student'::text])),
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT organization_positions_pkey PRIMARY KEY (id),
  CONSTRAINT organization_positions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.organization_officers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  full_name text NOT NULL,
  position text NOT NULL,
  department text,
  course text,
  year_level text,
  photo_url text,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  contact_number text,
  email text,
  CONSTRAINT organization_officers_pkey PRIMARY KEY (id),
  CONSTRAINT organization_officers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL CHECK (category = ANY (ARRAY['memorandum'::text, 'resolution'::text, 'financial_report'::text, 'policy'::text, 'form'::text, 'organization_records'::text, 'accreditation'::text, 'constitution_bylaws'::text, 'activity_documents'::text, 'other'::text])),
  status text NOT NULL DEFAULT 'active'::text CHECK (status = ANY (ARRAY['active'::text, 'archived'::text])),
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  file_type text,
  storage_bucket text NOT NULL DEFAULT 'official-documents'::text,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  document_number text NOT NULL UNIQUE,
  organization_id uuid,
  file_path text,
  uploaded_by_name text,
  custom_document_type text,
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.document_id_counters (
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  CONSTRAINT document_id_counters_pkey PRIMARY KEY (year)
);
CREATE TABLE public.document_activity_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid,
  document_title text NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY['upload'::text, 'edit'::text, 'archive'::text, 'unarchive'::text, 'delete'::text])),
  actor_id uuid,
  actor_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT document_activity_log_pkey PRIMARY KEY (id),
  CONSTRAINT document_activity_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id),
  CONSTRAINT document_activity_log_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id)
);
CREATE TABLE public.conversation_settings (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  is_muted boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  is_deleted boolean NOT NULL DEFAULT false,
  manually_marked_unread boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT conversation_settings_pkey PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT conversation_settings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT conversation_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id),
  CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.message_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  reporter_id uuid,
  reported_user_id uuid,
  conversation_id uuid,
  reason text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  message_id uuid,
  CONSTRAINT message_reports_pkey PRIMARY KEY (id),
  CONSTRAINT message_reports_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT message_reports_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id),
  CONSTRAINT message_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id),
  CONSTRAINT message_reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.message_reactions (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  reaction text NOT NULL CHECK (reaction = ANY (ARRAY['like'::text, 'love'::text, 'haha'::text, 'wow'::text, 'sad'::text, 'angry'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT message_reactions_pkey PRIMARY KEY (message_id, user_id),
  CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id),
  CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.pinned_messages (
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  pinned_by uuid NOT NULL,
  pinned_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pinned_messages_pkey PRIMARY KEY (message_id),
  CONSTRAINT pinned_messages_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id),
  CONSTRAINT pinned_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT pinned_messages_pinned_by_fkey FOREIGN KEY (pinned_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.message_removals (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  removed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT message_removals_pkey PRIMARY KEY (message_id, user_id),
  CONSTRAINT message_removals_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id),
  CONSTRAINT message_removals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text,
  target_table text,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.report_id_counters (
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  CONSTRAINT report_id_counters_pkey PRIMARY KEY (year)
);
CREATE TABLE public.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  report_id text NOT NULL UNIQUE,
  reporter_id uuid,
  reporter_name text,
  reporter_role text,
  organization_id uuid,
  organization_name text,
  recipient_type text NOT NULL CHECK (recipient_type = ANY (ARRAY['org_president'::text, 'osoa_eb_position'::text])),
  recipient_organization_id uuid,
  recipient_position text,
  report_title text NOT NULL,
  report_type text NOT NULL,
  specified_type text,
  report_details text,
  attachment_file_name text,
  attachment_file_path text,
  attachment_file_type text,
  attachment_file_size bigint,
  storage_bucket text,
  status USER-DEFINED NOT NULL DEFAULT 'submitted'::report_status,
  remarks text,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id),
  CONSTRAINT reports_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id),
  CONSTRAINT reports_recipient_organization_id_fkey FOREIGN KEY (recipient_organization_id) REFERENCES public.organizations(id),
  CONSTRAINT reports_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(id)
);
