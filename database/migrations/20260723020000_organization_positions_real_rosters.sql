-- LINGKOD Meneses - replaces the generic 22-position roster every
-- non-OSOA organization shared (20260723010000's placeholder, seeded
-- before real per-organization data existed) with each organization's
-- actual, distinct officer list. profiles.position is plain text, not a
-- foreign key into organization_positions - deleting/replacing the
-- catalog here has no effect on any already-registered account, only on
-- what the dropdown offers to future registrants.
--
-- Implemented one organization at a time (not a shared cross join) since
-- every organization's roster is now genuinely different, matching how
-- the brief itself was written.

-- OSOA's own 4 positions are untouched by this migration (still exactly
-- Chairperson/Vice Chairperson/Associate for Publication/Associate for
-- Ethics -> osoa_eb, from 20260723010000) - only the 16 student
-- organizations' generic placeholder rows are cleared before reseeding.
delete from public.organization_positions op
using public.organizations o
where op.organization_id = o.id
  and o.slug <> 'osoa-meneses';

-- ===================================================================
-- Bulacan Woodpushers
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Treasurer', 4),
  ('Auditor', 5),
  ('Multimedia Chairperson', 6),
  ('Delegations Chairperson', 7),
  ('Membership Chairperson', 8),
  ('Multimedia Co-Chairperson', 9),
  ('Membership Co-Chairperson', 10),
  ('Delegations Co-Chairperson', 11),
  ('Member', 12)
) as p(position_name, display_order)
where o.slug = 'bulakan-woodpushers'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- BulSU Maharlika
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Assistant Secretary', 4),
  ('Treasurer', 5),
  ('Auditor', 6),
  ('Public Information Officer', 7),
  ('Inclusion, Equity and Diversity Head', 8),
  ('Membership Head', 9),
  ('Member', 10)
) as p(position_name, display_order)
where o.slug = 'bulsu-maharlika'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- BulSU Uprising SOAR
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Treasurer', 4),
  ('Auditor', 5),
  ('PRO', 6),
  ('Tech Head', 7),
  ('Tech Committee', 8),
  ('Member', 9)
) as p(position_name, display_order)
where o.slug = 'soar'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- Business Administration Organization (BA ORG)
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President for Internal Affairs', 2),
  ('Vice President for External Affairs', 3),
  ('Secretary', 4),
  ('Assistant Secretary', 5),
  ('Treasurer', 6),
  ('Auditor', 7),
  ('4th Year Representative', 8),
  ('3rd Year Representative', 9),
  ('2nd Year Representative', 10),
  ('1st Year Representative', 11),
  ('Member', 12)
) as p(position_name, display_order)
where o.slug = 'ba-org'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- Community Events of Hospitality Management (CHEM)
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Treasurer', 4),
  ('Auditor', 5),
  ('Multimedia Head', 6),
  ('Multimedia Associate', 7),
  ('Program Head', 8),
  ('Program Coordinator', 9),
  ('Program Associate', 10),
  ('1st Year Representative', 11),
  ('2nd Year Representative', 12),
  ('3rd Year Representative', 13),
  ('4th Year Representative', 14),
  ('Member', 15)
) as p(position_name, display_order)
where o.slug = 'chem'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- CS BYTE
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President for Internal Affairs', 2),
  ('Vice President for External Affairs', 3),
  ('Secretary', 4),
  ('Treasurer', 5),
  ('Auditor', 6),
  ('Public Relations Officer', 7),
  ('Media Head', 8),
  ('Sports Head', 9),
  ('Technical Head', 10),
  ('Document Head', 11),
  ('Creative Head', 12),
  ('1st Year Representative', 13),
  ('2nd Year Representative', 14),
  ('3rd Year Representative', 15),
  ('4th Year Representative', 16),
  ('Member', 17)
) as p(position_name, display_order)
where o.slug = 'cs-byte'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- Every Nation Campus (ENC BulSU)
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Treasurer', 4),
  ('Auditor', 5),
  ('Public Relations Officer', 6),
  ('Member', 7)
) as p(position_name, display_order)
where o.slug = 'enc-bulsu-mc'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- ICpEP.SE BulSU
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President for External Affairs', 2),
  ('Vice President for Internal Affairs', 3),
  ('Secretary', 4),
  ('Assistant Secretary', 5),
  ('Treasurer', 6),
  ('Assistant Treasurer', 7),
  ('Auditor', 8),
  ('PRO', 9),
  ('Board of Director', 10),
  ('Documentation Team Head', 11),
  ('E-sports Team Head', 12),
  ('Multimedia Team Head', 13),
  ('Programming Team Head', 14),
  ('Social Media Team Head', 15),
  ('Writers Team Head', 16),
  ('Documentation Team Assistant', 17),
  ('E-sports Team Assistant', 18),
  ('Multimedia Team Assistant', 19),
  ('Programming Team Assistant', 20),
  ('Social Media Team Assistant', 21),
  ('Writers Team Assistant', 22),
  ('Member', 23)
) as p(position_name, display_order)
where o.slug = 'icpep-se-mc'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- KaPINAS
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'Pangulo' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('Pangulo', 1),
  ('Pangalawang Pangulo', 2),
  ('Kalihim', 3),
  ('Katuwang na Kalihim', 4),
  ('Ingat-Yaman', 5),
  ('Tagasuri', 6),
  ('Kinatawan (4th Year)', 7),
  ('Kinatawan (3rd Year)', 8),
  ('Dibuhista (4th Year)', 9),
  ('Dibuhista (3rd Year)', 10),
  ('Liksikritor (4th Year)', 11),
  ('Liksikritor (3rd Year)', 12),
  ('Member', 13)
) as p(position_name, display_order)
where o.slug = 'kapinas-fil'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- Red Cross Youth Council
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President for Internal', 2),
  ('Vice President for External', 3),
  ('Secretary', 4),
  ('Assistant Secretary', 5),
  ('Treasurer', 6),
  ('Assistant Treasurer', 7),
  ('Auditor', 8),
  ('PIO', 9),
  ('Logistic Officer', 10),
  ('Ethics and Discipline Officer', 11),
  ('Member', 12)
) as p(position_name, display_order)
where o.slug = 'rcyc-mc'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- Rotaract Club of BulSU Meneses Campus
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Assistant Secretary', 4),
  ('Treasurer', 5),
  ('Auditor', 6),
  ('Protocol Officer', 7),
  ('Public Information Officer', 8),
  ('Immediate Past President', 9),
  ('Director for International Service', 10),
  ('Director for Community Service', 11),
  ('Director for Professional Development', 12),
  ('Director for Finance', 13),
  ('Director for Club Foundation', 14),
  ('Director for Public Image', 15),
  ('Director for Membership', 16),
  ('Director of Diversity, Equity and Inclusion', 17),
  ('Member', 18)
) as p(position_name, display_order)
where o.slug = 'rac-bmc'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- SAMAKA
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Treasurer', 4),
  ('Auditor', 5),
  ('PIO', 6),
  ('Member', 7)
) as p(position_name, display_order)
where o.slug = 'samaka'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- SEED
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Treasurer', 4),
  ('Auditor', 5),
  ('PRO', 6),
  ('4th Year Representative', 7),
  ('3rd Year Representative', 8),
  ('Program Team Head', 9),
  ('Program Team', 10),
  ('Technical Team Head', 11),
  ('Technical Team', 12),
  ('Member', 13)
) as p(position_name, display_order)
where o.slug = 'seed'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- Sipnayan Society
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Assistant Secretary', 4),
  ('Treasurer', 5),
  ('Auditor', 6),
  ('Member', 7)
) as p(position_name, display_order)
where o.slug = 'sipnayan-society'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- SPHERE
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Secretary', 3),
  ('Treasurer', 4),
  ('Auditor', 5),
  ('PIO', 6),
  ('4th Year Representative', 7),
  ('3rd Year Representative', 8),
  ('Member', 9)
) as p(position_name, display_order)
where o.slug = 'sphere'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

-- ===================================================================
-- Sovereign Dance Athletics (SDA)
-- ===================================================================
insert into public.organization_positions (organization_id, position_name, system_role, display_order)
select o.id, p.position_name, case when p.position_name = 'President' then 'org_president' else 'student' end, p.display_order
from public.organizations o
cross join (values
  ('President', 1),
  ('Vice President', 2),
  ('Cheer Co-Captain', 3),
  ('Member', 4)
) as p(position_name, display_order)
where o.slug = 'sda'
on conflict (organization_id, position_name) do update
  set system_role = excluded.system_role, display_order = excluded.display_order, is_active = true;

notify pgrst, 'reload schema';
