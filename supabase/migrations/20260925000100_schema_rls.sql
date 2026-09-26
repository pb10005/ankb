-- @covers AC-006, AC-007, AC-008, AC-009, AC-017, AC-085, AC-086, AC-087, AC-088, AC-089, AC-090, AC-091, AC-092
-- @covers AC-015
-- @covers AC-010, AC-011, AC-012, AC-013, AC-014, AC-093, AC-094, AC-095, AC-096, AC-097, AC-098, AC-099, AC-113
-- @assumption AS-004
-- @assumption AS-005
-- @assumption AS-006
-- @assumption AS-007
-- @assumption AS-008
-- @assumption AS-032
-- @assumption AS-033
-- @assumption AS-034
-- @assumption AS-035
-- @assumption AS-036
-- @assumption AS-038
-- @assumption AS-041
-- @assumption AS-003
-- @assumption AS-010
-- @assumption AS-052
-- @assumption AS-065
-- @assumption AS-066
--
-- ankb のスキーマと権限（指示書 §4 / §5）。§5 と §4.2 は変更禁止。
-- 閲覧・編集の判定は can_view_note / can_edit_note に一本化し、全テーブルのポリシーがこれを呼ぶ。
-- superseded への遷移は note_relation の状態変更トリガーだけが行う。

create extension if not exists vector with schema extensions;

-- ───────────────────────── テーブル ─────────────────────────

create table public.workspace (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.member (
  workspace_id uuid not null references public.workspace(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspace(id),
  owner_id uuid not null default auth.uid() references auth.users(id),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 100000),
  status text not null default 'draft' check (status in ('draft', 'active', 'superseded', 'archived')),
  visibility text not null default 'private' check (visibility in ('private', 'shared', 'workspace')),
  effective_from date,
  superseded_by uuid references public.notes(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- オーナーは必ずそのノートの workspace のメンバー
  foreign key (workspace_id, owner_id) references public.member(workspace_id, user_id)
);
create index notes_workspace_idx on public.notes (workspace_id);
create index notes_owner_idx on public.notes (owner_id);

create table public.note_version (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (note_id, version)
);

create table public.note_share (
  note_id uuid not null,
  workspace_id uuid not null,
  user_id uuid not null,
  permission text not null check (permission in ('view', 'edit')),
  created_at timestamptz not null default now(),
  primary key (note_id, user_id),
  foreign key (note_id, workspace_id) references public.notes(id, workspace_id) on delete cascade,
  -- AS-006: 共有先は同じ workspace のメンバーに限る（FK は RLS を経由せず検査される）
  foreign key (workspace_id, user_id) references public.member(workspace_id, user_id) on delete cascade
);
create index note_share_user_idx on public.note_share (user_id);

create table public.note_chunk (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(1024),
  created_at timestamptz not null default now(),
  unique (note_id, chunk_index)
);

create table public.note_relation (
  id uuid primary key default gen_random_uuid(),
  from_note_id uuid not null references public.notes(id) on delete cascade,
  to_note_id uuid not null references public.notes(id) on delete cascade,
  type text not null check (type in ('supersedes', 'contradicts', 'related')),
  state text not null default 'proposed' check (state in ('proposed', 'confirmed', 'rejected')),
  proposed_by text not null check (proposed_by in ('ai', 'user', 'agent')),
  confidence double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  rationale text not null default '',
  created_by uuid default auth.uid(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_note_id <> to_note_id)
);
create index note_relation_from_idx on public.note_relation (from_note_id);
create index note_relation_to_idx on public.note_relation (to_note_id);

-- ───────────────────────── 判定関数 ─────────────────────────

-- AS-059: OAuth 経由で発行されたトークン（外部エージェント）かどうか。client_id クレームで識別する
create function public.is_oauth_client() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') <> ''
$$;

-- §5.1: private=オーナーのみ / shared=オーナー+note_share / workspace=workspace の全メンバー
create function public.can_view_note(p_note_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.notes n
    where n.id = p_note_id
      and (
        n.owner_id = (select auth.uid())
        or (n.visibility = 'workspace' and exists (
              select 1 from public.member m where m.workspace_id = n.workspace_id and m.user_id = (select auth.uid())))
        or (n.visibility = 'shared' and exists (
              select 1 from public.note_share s where s.note_id = n.id and s.user_id = (select auth.uid())))
      )
  )
$$;

-- §5.1: 編集はオーナー、または note_share.permission = edit を持つユーザー（閲覧できることが前提）
create function public.can_edit_note(p_note_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.can_view_note(p_note_id) and exists (
    select 1
    from public.notes n
    where n.id = p_note_id
      and (
        n.owner_id = (select auth.uid())
        or exists (select 1 from public.note_share s
                   where s.note_id = n.id and s.user_id = (select auth.uid()) and s.permission = 'edit')
      )
  )
$$;

-- ───────────────────────── notes のガード ─────────────────────────

create function public.notes_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status not in ('draft', 'active') then
    raise exception 'INVALID_STATUS: ノートは draft または active で作成する' using errcode = '22023';
  end if;
  if new.superseded_by is not null then
    raise exception 'INVALID_STATUS: superseded_by は承認経由でのみ設定される' using errcode = '22023';
  end if;
  new.version := 1;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

create trigger notes_before_insert before insert on public.notes
for each row execute function public.notes_before_insert();

-- 状態遷移トリガー（note_relation_after_state_change）からの更新だけが status=superseded / superseded_by を変更できる
create function public.notes_before_update() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- 状態遷移トリガー（SECURITY DEFINER）の中でだけ有効。authenticated ロールが直接立てても無視する
  internal boolean := coalesce(current_setting('ankb.relation_transition', true), '') = 'on'
                      and current_user <> 'authenticated';
begin
  if new.owner_id is distinct from old.owner_id or new.workspace_id is distinct from old.workspace_id then
    raise exception 'FORBIDDEN: owner_id と workspace_id は変更できない' using errcode = '42501';
  end if;

  if new.visibility is distinct from old.visibility
     and (old.owner_id is distinct from (select auth.uid()) or public.is_oauth_client()) then
    raise exception 'FORBIDDEN: 公開範囲はオーナーだけが変更できる' using errcode = '42501';
  end if;

  if not internal then
    if new.superseded_by is distinct from old.superseded_by then
      raise exception 'INVALID_TRANSITION: superseded_by は置き換え関係の承認でのみ変わる' using errcode = '42501';
    end if;
    if (new.status = 'superseded') is distinct from (old.status = 'superseded') then
      raise exception 'INVALID_TRANSITION: superseded への遷移と解除は置き換え関係の承認・取り消しでのみ起こる' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'draft' and new.status in ('active', 'archived'))
      or (old.status = 'active' and new.status = 'archived')
    ) then
      raise exception 'INVALID_TRANSITION: % から % へは遷移できない', old.status, new.status using errcode = '42501';
    end if;
  end if;

  -- 状態遷移トリガーによる変更は利用者の編集ではないので version を上げない（AS-064）
  if not internal then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger notes_before_update before update on public.notes
for each row execute function public.notes_before_update();

-- 版履歴: 本文・タイトルが変わったら更新前の内容を note_version に残す（編集者の権限で書く）
create function public.notes_after_update_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.title is distinct from old.title or new.body is distinct from old.body then
    insert into public.note_version (note_id, version, title, body)
    values (old.id, old.version, old.title, old.body);
  end if;
  return null;
end;
$$;

create trigger notes_after_update_version after update on public.notes
for each row execute function public.notes_after_update_version();

-- ───────────────────────── 置き換え関係の状態遷移 ─────────────────────────

-- AS-034: 置き換え対象の status と superseded_by を、confirmed の supersedes から再計算する
create function public.note_relation_after_state_change() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  latest_from uuid;
begin
  if new.type <> 'supersedes' or new.state is not distinct from old.state then
    return null;
  end if;

  select r.from_note_id into latest_from
  from public.note_relation r
  where r.to_note_id = new.to_note_id and r.type = 'supersedes' and r.state = 'confirmed'
  order by r.resolved_at desc nulls last, r.created_at desc
  limit 1;

  perform set_config('ankb.relation_transition', 'on', true);
  if latest_from is not null then
    update public.notes set status = 'superseded', superseded_by = latest_from where id = new.to_note_id;
  else
    update public.notes set status = 'active', superseded_by = null
    where id = new.to_note_id and status = 'superseded';
  end if;
  perform set_config('ankb.relation_transition', 'off', true);
  return null;
end;
$$;

create trigger note_relation_after_state_change after update of state on public.note_relation
for each row execute function public.note_relation_after_state_change();

-- 承認・却下・取り消しの唯一の入口（AS-007 / AS-033 / AS-035 / AS-036 / AS-059）
create function public.resolve_relation(p_relation_id uuid, p_decision text) returns public.note_relation
language plpgsql security definer
set search_path = ''
as $$
declare
  rel public.note_relation;
  src public.notes;
  dst public.notes;
  uid uuid := (select auth.uid());
begin
  if uid is null or public.is_oauth_client() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_decision not in ('confirm', 'reject', 'revoke') then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  select * into rel from public.note_relation where id = p_relation_id for update;
  -- AC-098: 存在しない関係と閲覧できない関係は同じ応答にする
  if not found or not (public.can_view_note(rel.from_note_id) and public.can_view_note(rel.to_note_id)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.can_edit_note(rel.from_note_id) and public.can_edit_note(rel.to_note_id)) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_decision in ('confirm', 'reject') and rel.state <> 'proposed' then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;
  if p_decision = 'revoke' and rel.state <> 'confirmed' then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;

  if p_decision = 'confirm' and rel.type = 'supersedes' then
    select * into src from public.notes where id = rel.from_note_id;
    select * into dst from public.notes where id = rel.to_note_id;
    if src.status <> 'active' or dst.status not in ('active', 'superseded') then
      raise exception 'INVALID_TRANSITION' using errcode = '42501';
    end if;
    -- 循環: 置き換え対象が、confirmed の supersedes をたどって置き換え元を既に置き換えている
    if exists (
      with recursive reach(note_id) as (
        select r.to_note_id from public.note_relation r
        where r.from_note_id = rel.to_note_id and r.type = 'supersedes' and r.state = 'confirmed'
        union
        select r.to_note_id from public.note_relation r
        join reach on r.from_note_id = reach.note_id
        where r.type = 'supersedes' and r.state = 'confirmed'
      )
      select 1 from reach where note_id = rel.from_note_id
    ) then
      raise exception 'CYCLE' using errcode = '42501';
    end if;
  end if;

  update public.note_relation
  set state = case p_decision when 'confirm' then 'confirmed' else 'rejected' end,
      resolved_by = uid,
      resolved_at = clock_timestamp()
  where id = p_relation_id
  returning * into rel;
  return rel;
end;
$$;

-- ───────────────────────── 閲覧用ビュー ─────────────────────────

-- AS-032: superseded_by は置き換え先を閲覧できる場合だけ返す。notes.superseded_by 列は直接公開しない
create view public.notes_visible as
select
  n.id, n.workspace_id, n.owner_id, n.title, n.body, n.status, n.visibility, n.effective_from,
  case when n.superseded_by is not null and public.can_view_note(n.superseded_by) then n.superseded_by end as superseded_by,
  n.version, n.created_at, n.updated_at
from public.notes n
where public.can_view_note(n.id);

-- ───────────────────────── RLS ─────────────────────────

alter table public.workspace enable row level security;
alter table public.member enable row level security;
alter table public.notes enable row level security;
alter table public.note_version enable row level security;
alter table public.note_share enable row level security;
alter table public.note_chunk enable row level security;
alter table public.note_relation enable row level security;

-- anon には何も見せない（AC-017）
revoke all on public.workspace, public.member, public.notes, public.note_version, public.note_share,
  public.note_chunk, public.note_relation, public.notes_visible from anon;
revoke all on public.workspace, public.member, public.notes, public.note_version, public.note_share,
  public.note_chunk, public.note_relation, public.notes_visible from authenticated;

-- anon は SELECT できるが、anon 向けのポリシーが無いので常に0行（AC-017）
grant select (id, workspace_id, owner_id, title, body, status, visibility, effective_from, version, created_at, updated_at)
  on public.notes to anon;
grant select on public.note_relation, public.note_chunk to anon;

-- workspace: 所属しているものだけ見える。作成・変更はシードのみ（AS-003）
grant select on public.workspace to authenticated;
create policy workspace_select on public.workspace for select to authenticated
using (exists (select 1 from public.member m where m.workspace_id = workspace.id and m.user_id = (select auth.uid())));

-- member: 自分の所属行だけ見える。追加・変更・削除は workspace の owner だけ（AC-086）
grant select, insert, update, delete on public.member to authenticated;
create policy member_select on public.member for select to authenticated
using (user_id = (select auth.uid()));
create policy member_insert on public.member for insert to authenticated
with check (
  not public.is_oauth_client()
  and exists (select 1 from public.member m
              where m.workspace_id = member.workspace_id and m.user_id = (select auth.uid()) and m.role = 'owner')
);
-- USING は自分の行も対象に含め、WITH CHECK で owner 以外を拒否する。
-- （USING で弾くと 0 行更新で黙って成功し、権限昇格の試みがエラーにならない: AC-086）
create policy member_update on public.member for update to authenticated
using (
  user_id = (select auth.uid())
  or exists (select 1 from public.member m
             where m.workspace_id = member.workspace_id and m.user_id = (select auth.uid()) and m.role = 'owner')
)
with check (
  not public.is_oauth_client()
  and exists (select 1 from public.member m
              where m.workspace_id = member.workspace_id and m.user_id = (select auth.uid()) and m.role = 'owner')
);
create policy member_delete on public.member for delete to authenticated
using (
  not public.is_oauth_client()
  and exists (select 1 from public.member m
              where m.workspace_id = member.workspace_id and m.user_id = (select auth.uid()) and m.role = 'owner')
);

-- notes: superseded_by 列は SELECT 権限を与えない（notes_visible 経由で読む）
grant select (id, workspace_id, owner_id, title, body, status, visibility, effective_from, version, created_at, updated_at)
  on public.notes to authenticated;
grant insert (workspace_id, owner_id, title, body, status, visibility, effective_from) on public.notes to authenticated;
grant update (title, body, status, visibility, effective_from) on public.notes to authenticated;
create policy notes_select on public.notes for select to authenticated
using (public.can_view_note(id));
create policy notes_insert on public.notes for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.member m where m.workspace_id = notes.workspace_id and m.user_id = (select auth.uid()))
);
create policy notes_update on public.notes for update to authenticated
using (public.can_edit_note(id))
with check (public.can_edit_note(id));

grant select on public.notes_visible to authenticated;

-- note_version / note_chunk: 閲覧はノートの閲覧権限、書き込みは編集権限（AS-041）
grant select, insert on public.note_version to authenticated;
create policy note_version_select on public.note_version for select to authenticated
using (public.can_view_note(note_id));
create policy note_version_insert on public.note_version for insert to authenticated
with check (public.can_edit_note(note_id));

grant select, insert, update, delete on public.note_chunk to authenticated;
create policy note_chunk_select on public.note_chunk for select to authenticated
using (public.can_view_note(note_id));
create policy note_chunk_insert on public.note_chunk for insert to authenticated
with check (public.can_edit_note(note_id));
create policy note_chunk_update on public.note_chunk for update to authenticated
using (public.can_edit_note(note_id)) with check (public.can_edit_note(note_id));
create policy note_chunk_delete on public.note_chunk for delete to authenticated
using (public.can_edit_note(note_id));

-- note_share: オーナーは全行、共有された本人は自分の行だけ見える。書き込みはオーナーだけ（AS-008 / AS-041）
grant select, insert, update, delete on public.note_share to authenticated;
create policy note_share_select on public.note_share for select to authenticated
using (
  public.can_view_note(note_id)
  and (user_id = (select auth.uid())
       or exists (select 1 from public.notes n where n.id = note_share.note_id and n.owner_id = (select auth.uid())))
);
create policy note_share_insert on public.note_share for insert to authenticated
with check (
  not public.is_oauth_client()
  and exists (select 1 from public.notes n where n.id = note_share.note_id and n.owner_id = (select auth.uid()))
);
create policy note_share_update on public.note_share for update to authenticated
using (
  not public.is_oauth_client()
  and exists (select 1 from public.notes n where n.id = note_share.note_id and n.owner_id = (select auth.uid()))
)
with check (exists (select 1 from public.notes n where n.id = note_share.note_id and n.owner_id = (select auth.uid())));
create policy note_share_delete on public.note_share for delete to authenticated
using (
  not public.is_oauth_client()
  and exists (select 1 from public.notes n where n.id = note_share.note_id and n.owner_id = (select auth.uid()))
);

-- note_relation: 両端のノートを閲覧できる場合だけ見える（§5.2-4）。人間・エージェントは proposed の提案だけ作れる。
-- 状態の変更は resolve_relation を通す（UPDATE / DELETE 権限は与えない）
grant select on public.note_relation to authenticated;
grant insert (from_note_id, to_note_id, type, state, proposed_by, confidence, rationale, resolved_by, resolved_at)
  on public.note_relation to authenticated;
create policy note_relation_select on public.note_relation for select to authenticated
using (public.can_view_note(from_note_id) and public.can_view_note(to_note_id));
create policy note_relation_insert on public.note_relation for insert to authenticated
with check (
  state = 'proposed'
  and resolved_by is null
  and resolved_at is null
  and proposed_by in ('user', 'agent')
  and created_by = (select auth.uid())
  and public.can_view_note(from_note_id)
  and public.can_view_note(to_note_id)
);

-- 関数の実行権限
revoke execute on function public.note_relation_after_state_change() from public, anon, authenticated;
revoke execute on function public.notes_before_insert() from public, anon, authenticated;
revoke execute on function public.notes_before_update() from public, anon, authenticated;
revoke execute on function public.notes_after_update_version() from public, anon, authenticated;
revoke execute on function public.resolve_relation(uuid, text) from public, anon;
grant execute on function public.resolve_relation(uuid, text) to authenticated;
revoke execute on function public.can_view_note(uuid) from public, anon;
revoke execute on function public.can_edit_note(uuid) from public, anon;
grant execute on function public.can_view_note(uuid) to authenticated;
grant execute on function public.can_edit_note(uuid) to authenticated;
