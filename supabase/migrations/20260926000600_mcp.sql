-- @covers AC-068, AC-119
-- @assumption AS-078
-- サーバMCP（指示書 §7.1）の DB 側。

-- ask の回数上限の記録（AS-054）。本人の行だけ読み書きできる
create table public.ask_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ask_usage_user_time on public.ask_usage (user_id, created_at);
alter table public.ask_usage enable row level security;
revoke all on public.ask_usage from anon, authenticated;
grant select, insert on public.ask_usage to authenticated;
create policy ask_usage_select on public.ask_usage for select to authenticated using (user_id = (select auth.uid()));
create policy ask_usage_insert on public.ask_usage for insert to authenticated with check (user_id = (select auth.uid()));

-- 置き換えの連鎖（get_note_lineage）。confirmed の supersedes を両方向にたどり、
-- 呼び出し者が閲覧できるノートだけを返す（閲覧できない中間ノートは id・タイトルを出さずに飛ばす: AC-068）
create function public.note_lineage(p_note_id uuid)
returns table (note_id uuid, title text, status text, date text, superseded_by uuid)
language sql stable security definer
set search_path = ''
as $$
  with recursive chain(id) as (
    select p_note_id where public.can_view_note(p_note_id)
    union
    select case when r.from_note_id = c.id then r.to_note_id else r.from_note_id end
    from public.note_relation r
    join chain c on c.id in (r.from_note_id, r.to_note_id)
    where r.type = 'supersedes' and r.state = 'confirmed'
  )
  select n.id, n.title, n.status,
         coalesce(n.effective_from::text, to_char(n.created_at at time zone 'UTC', 'YYYY-MM-DD')),
         case when n.superseded_by is not null and public.can_view_note(n.superseded_by) then n.superseded_by end
  from chain c join public.notes n on n.id = c.id
  where public.can_view_note(n.id)
  order by 4, n.created_at
$$;
revoke execute on function public.note_lineage(uuid) from public, anon;
grant execute on function public.note_lineage(uuid) to authenticated;

-- propose_relation（MCP）はアプリ側で id を採番して挿入する（RETURNING は SELECT ポリシーの STABLE 関数が挿入中の行を見られない）
grant insert (id) on public.note_relation to authenticated;
