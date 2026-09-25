-- @covers AC-020
-- @assumption AS-060
-- 共有先を選ぶための同僚一覧。member は自分の行しか見えない（自己参照ポリシーの再帰を避けるため）ので、
-- 呼び出し者が所属する workspace のメンバーだけを返すビューを置く。関数ではなくビューにして
-- SECURITY DEFINER 関数の許可リスト（AC-091）を増やさない。
create view public.workspace_directory as
select m.workspace_id, m.user_id, m.role,
       coalesce(u.raw_user_meta_data ->> 'display_name', u.email) as display_name,
       u.email
from public.member m
join auth.users u on u.id = m.user_id
where exists (
  select 1 from public.member me
  where me.workspace_id = m.workspace_id and me.user_id = (select auth.uid())
);

revoke all on public.workspace_directory from anon, authenticated;
grant select on public.workspace_directory to authenticated;
