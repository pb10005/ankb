-- @covers AC-120
-- @assumption AS-080
-- OAuth 経由のトークン（外部エージェント）が PostgREST を直接叩いても、§7.1 で人間の Web UI に限った操作をできないようにする
-- （AS-059 の拡張: 削除（アーカイブ）・公開範囲を指定した作成・人間を名乗る提案を拒否する）

create or replace function public.notes_oauth_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_oauth_client() then
    return new;
  end if;
  if tg_op = 'INSERT' and new.visibility <> 'private' then
    raise exception 'FORBIDDEN: 外部エージェントは公開範囲を指定してノートを作成できない' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status = 'archived' and old.status <> 'archived' then
    raise exception 'FORBIDDEN: 外部エージェントはノートをアーカイブ（削除）できない' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.notes_oauth_guard() from public, anon, authenticated;
create trigger notes_oauth_guard before insert or update on public.notes
for each row execute function public.notes_oauth_guard();

-- 提案元の偽装防止: OAuth クライアントの提案は agent、人間のセッションの提案は user に限る
drop policy note_relation_insert on public.note_relation;
create policy note_relation_insert on public.note_relation for insert to authenticated
with check (
  state = 'proposed'
  and resolved_by is null
  and resolved_at is null
  and proposed_by = case when public.is_oauth_client() then 'agent' else proposed_by end
  and proposed_by in ('user', 'agent')
  and created_by = (select auth.uid())
  and public.can_view_note(from_note_id)
  and public.can_view_note(to_note_id)
);

-- ask の回数上限を判定と記録を1回で行う（並行リクエストで上限を超えない: AS-054）
create function public.consume_ask_quota(p_limit integer) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('ankb-ask-quota:' || (select auth.uid())::text));
  select count(*) into n from public.ask_usage
  where user_id = (select auth.uid()) and created_at > now() - interval '1 hour';
  if n >= p_limit then
    return false;
  end if;
  insert into public.ask_usage default values;
  return true;
end;
$$;
revoke execute on function public.consume_ask_quota(integer) from public, anon;
grant execute on function public.consume_ask_quota(integer) to authenticated;
