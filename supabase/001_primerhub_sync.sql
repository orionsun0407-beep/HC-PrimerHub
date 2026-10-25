-- Phase 1: additive schema and transactional sync RPC. Run as project administrator.
-- Does not delete primers, templates, or storage objects.
begin;
alter table public.primers add column if not exists revision bigint not null default 0;
alter table public.primers add column if not exists deleted_at timestamptz;
alter table public.order_templates add column if not exists revision bigint not null default 0;
alter table public.order_templates add column if not exists deleted_at timestamptz;
create table if not exists public.hc_wb_changes(
 cursor bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 entity text not null check(entity in ('primers','order_templates')),
 record_id uuid not null,body jsonb not null,created_at timestamptz not null default now()
);
create index if not exists hc_wb_changes_user_cursor on public.hc_wb_changes(user_id,cursor);
create table if not exists public.hc_wb_requests(
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null,fingerprint jsonb not null,response jsonb not null,
 primary key(user_id,request_id)
);
alter table public.hc_wb_changes enable row level security;
alter table public.hc_wb_requests enable row level security;
drop policy if exists hc_wb_changes_read on public.hc_wb_changes;
create policy hc_wb_changes_read on public.hc_wb_changes for select to authenticated using(auth.uid()=user_id);
grant select on public.hc_wb_changes to authenticated;
revoke all on public.hc_wb_requests from anon,authenticated;

create or replace function public.hc_wb_revision() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then new.revision:=greatest(new.revision,0)+1;else new.revision:=old.revision+1;end if;
 new.updated_at:=now();return new;
end $$;
create or replace function public.hc_wb_journal() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare b jsonb;
begin
 if tg_op='DELETE' then b:=to_jsonb(old)||jsonb_build_object('revision',old.revision+1,'deleted_at',now());else b:=to_jsonb(new);end if;
 insert into public.hc_wb_changes(user_id,entity,record_id,body)values((b->>'user_id')::uuid,tg_table_name,(b->>'id')::uuid,b);
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
drop trigger if exists hc_wb_revision on public.primers;
create trigger hc_wb_revision before insert or update on public.primers for each row execute function public.hc_wb_revision();
drop trigger if exists hc_wb_revision on public.order_templates;
create trigger hc_wb_revision before insert or update on public.order_templates for each row execute function public.hc_wb_revision();
drop trigger if exists hc_wb_journal on public.primers;
create trigger hc_wb_journal after insert or update or delete on public.primers for each row execute function public.hc_wb_journal();
drop trigger if exists hc_wb_journal on public.order_templates;
create trigger hc_wb_journal after insert or update or delete on public.order_templates for each row execute function public.hc_wb_journal();
insert into public.hc_wb_changes(user_id,entity,record_id,body)
select p.user_id,'primers',p.id,to_jsonb(p) from public.primers p
where not exists(select 1 from public.hc_wb_changes c where c.entity='primers' and c.record_id=p.id and c.user_id=p.user_id);
insert into public.hc_wb_changes(user_id,entity,record_id,body)
select p.user_id,'order_templates',p.id,to_jsonb(p) from public.order_templates p
where not exists(select 1 from public.hc_wb_changes c where c.entity='order_templates' and c.record_id=p.id and c.user_id=p.user_id);

create or replace function public.hc_wb_capabilities() returns jsonb
language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('version',1,'rpc_only',not has_table_privilege('authenticated','public.primers','UPDATE'))
$$;
create or replace function public.hc_wb_pull(after_cursor bigint default 0)
returns table(cursor bigint,entity text,body jsonb)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.cursor,c.entity,c.body from public.hc_wb_changes c
 where c.user_id=auth.uid() and c.cursor>after_cursor order by c.cursor limit 500
$$;

create or replace function public.hc_wb_apply(request_id uuid,entity_name text,record_id uuid,expected_revision bigint,operation text,payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); current_row jsonb; current_revision bigint; result jsonb; prior public.hc_wb_requests%rowtype; fingerprint jsonb;
begin
 if owner_id is null then raise exception 'Authentication required';end if;
 if request_id is null or record_id is null or expected_revision is null or expected_revision<0 then raise exception 'Identity and nonnegative expected revision are required';end if;
 if payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Payload must be a JSON object';end if;
 if entity_name is null or operation is null or entity_name not in ('primers','order_templates') or operation not in ('upsert','delete') then raise exception 'Unsupported sync entity or operation';end if;
 if payload ? 'user_id' and (payload->>'user_id')::uuid<>owner_id then raise exception 'Account identity mismatch';end if;
 if payload ? 'id' and (payload->>'id')::uuid<>record_id then raise exception 'Record identity mismatch';end if;
 fingerprint:=jsonb_build_object('entity',entity_name,'id',record_id,'revision',expected_revision,'operation',operation,'payload',payload);
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||request_id::text,0));
 select * into prior from public.hc_wb_requests r where r.user_id=owner_id and r.request_id=hc_wb_apply.request_id;
 if found then
  if prior.fingerprint<>fingerprint then raise exception 'Request ID reused with different content';end if;
  return prior.response;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||entity_name||record_id::text,0));
 if entity_name='primers' then
  if exists(select 1 from public.primers p where p.id=record_id and p.user_id<>owner_id) then raise exception 'Record is not owned by current account';end if;
  select to_jsonb(p) into current_row from public.primers p where p.id=record_id and p.user_id=owner_id for update;
 else
  if exists(select 1 from public.order_templates p where p.id=record_id and p.user_id<>owner_id) then raise exception 'Record is not owned by current account';end if;
  select to_jsonb(p) into current_row from public.order_templates p where p.id=record_id and p.user_id=owner_id for update;
 end if;
 if current_row is null then
  select c.body into current_row from public.hc_wb_changes c where c.user_id=owner_id and c.entity=entity_name and c.record_id=hc_wb_apply.record_id order by c.cursor desc limit 1;
 end if;
 current_revision:=coalesce((current_row->>'revision')::bigint,0);
 if current_revision<>expected_revision then return jsonb_build_object('status','conflict','row',coalesce(current_row,jsonb_build_object('id',record_id,'user_id',owner_id,'revision',0,'deleted_at',now())));end if;
 if operation='delete' then
  if current_row is null then result:=jsonb_build_object('id',record_id,'user_id',owner_id,'revision',1,'deleted_at',now());insert into public.hc_wb_changes(user_id,entity,record_id,body)values(owner_id,entity_name,record_id,result);
  elsif entity_name='primers' then update public.primers p set deleted_at=now() where p.id=record_id and p.user_id=owner_id returning to_jsonb(p) into result;
  else update public.order_templates p set deleted_at=now() where p.id=record_id and p.user_id=owner_id returning to_jsonb(p) into result;end if;
  result:=coalesce(result,current_row);
 elsif entity_name='primers' then
  insert into public.primers(id,user_id,name,sequence,normalized_sequence,ordered_at,enzyme_sites,notes,binding_context,source_type,revision)
  values(record_id,owner_id,payload->>'name',payload->>'sequence',payload->>'normalized_sequence',(payload->>'ordered_at')::date,coalesce(payload->'enzyme_sites','[]'::jsonb),coalesce(payload->>'notes',''),payload->'binding_context',coalesce(payload->>'source_type','manual'),current_revision)
  on conflict(id) do update set name=excluded.name,sequence=excluded.sequence,normalized_sequence=excluded.normalized_sequence,ordered_at=excluded.ordered_at,enzyme_sites=excluded.enzyme_sites,notes=excluded.notes,binding_context=excluded.binding_context,source_type=excluded.source_type,deleted_at=null
  returning to_jsonb(primers.*) into result;
 else
  if left(payload->>'storage_path',length(owner_id::text)+1)<>owner_id::text||'/' then raise exception 'Template storage path is outside the current account';end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='order-templates' and o.name=payload->>'storage_path') then raise exception 'Template file has not been uploaded';end if;
  insert into public.order_templates(id,user_id,name,file_name,storage_path,mapping,defaults,revision)
  values(record_id,owner_id,payload->>'name',payload->>'file_name',payload->>'storage_path',payload->'mapping',payload->'defaults',current_revision)
  on conflict(id) do update set name=excluded.name,file_name=excluded.file_name,storage_path=excluded.storage_path,mapping=excluded.mapping,defaults=excluded.defaults,deleted_at=null
  returning to_jsonb(order_templates.*) into result;
 end if;
 result:=jsonb_build_object('status','ok','row',result);
 insert into public.hc_wb_requests(user_id,request_id,fingerprint,response)values(owner_id,request_id,fingerprint,result);
 return result;
end $$;
revoke all on function public.hc_wb_apply(uuid,text,uuid,bigint,text,jsonb) from public,anon;
revoke all on function public.hc_wb_pull(bigint) from public,anon;
grant execute on function public.hc_wb_apply(uuid,text,uuid,bigint,text,jsonb) to authenticated;
grant execute on function public.hc_wb_pull(bigint) to authenticated;
grant execute on function public.hc_wb_capabilities() to authenticated;
commit;
