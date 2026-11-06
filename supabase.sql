-- 신규 프로젝트의 SQL Editor에서 한 번 실행하세요.
begin;
create table public.tasks (
 user_id uuid not null references auth.users(id) on delete cascade,
 id text not null check (length(id) between 1 and 200),
 title text not null check (length(btrim(title)) between 1 and 160),
 description text not null default '' check (length(description)<=5000),
 status text not null default 'todo' check(status in ('todo','doing','done')),
 priority text not null default 'mid' check(priority in ('low','mid','high')),
 due date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(user_id,id)
);
create index tasks_user_created_idx on public.tasks(user_id,created_at);
create function public.touch_task() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at=now(); return new; end;
$$;
create trigger tasks_updated before update on public.tasks for each row execute function public.touch_task();
alter table public.tasks enable row level security;
revoke all on public.tasks from anon;
grant select,insert,update,delete on public.tasks to authenticated;
create policy tasks_select on public.tasks for select to authenticated using ((select auth.uid())=user_id);
create policy tasks_insert on public.tasks for insert to authenticated with check ((select auth.uid())=user_id);
create policy tasks_update on public.tasks for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy tasks_delete on public.tasks for delete to authenticated using ((select auth.uid())=user_id);
-- 自分のカードだけを一つのトランザクションで入れ替える。
create function public.replace_my_tasks(p_tasks jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 if jsonb_typeof(p_tasks) is distinct from 'array' then raise exception 'Expected array'; end if;
 -- 같은 계정의 백업 교체 요청을 직렬화합니다.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,0));
 delete from public.tasks where user_id=v_uid;
 insert into public.tasks(user_id,id,title,description,status,priority,due)
 select v_uid,x.id,x.title,x.description,x.status,x.priority,nullif(x.due,'')::date
 from pg_catalog.jsonb_to_recordset(p_tasks) as x(id text,title text,description text,status text,priority text,due text);
 -- 중복 ID, 잘못된 날짜, 제약조건 위반 시 DELETE까지 함께 롤백됩니다.
end;
$$;
revoke all on function public.replace_my_tasks(jsonb) from public,anon;
grant execute on function public.replace_my_tasks(jsonb) to authenticated;
commit;
