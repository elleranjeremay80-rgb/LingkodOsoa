-- LINGKOD Meneses - submissions_select RLS only ever treated
-- status = 'approved' as publicly (platform-wide) visible. Now that the
-- Submission & Tracking status workflow has a 'completed' stage reachable
-- after 'approved' (see frontend/pages/submission/script.js's
-- markSubmissionCompleted()), a completed submission would otherwise
-- disappear from every dashboard/profile feed the moment it's marked
-- complete. Widening the same-shaped policy to include it.

drop policy if exists "submissions_select" on public.submissions;

create policy "submissions_select"
  on public.submissions for select
  to authenticated
  using (
    submitted_by = auth.uid()
    or status in ('approved', 'completed')
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'osoa_eb'
    )
  );

notify pgrst, 'reload schema';
