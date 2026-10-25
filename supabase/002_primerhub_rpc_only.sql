-- Phase 2: run AFTER publishing the updated PrimerHub website.
-- Old open website tabs must refresh before further edits.
begin;
revoke insert,update,delete on public.primers,public.order_templates from anon,authenticated;
commit;
