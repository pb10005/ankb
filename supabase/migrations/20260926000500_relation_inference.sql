-- @covers AC-049, AC-051, AC-053, AC-055, AC-056, AC-058, AC-059, AC-114
-- @assumption AS-020
-- @assumption AS-023
-- @assumption AS-043
-- @assumption AS-074
-- 置き換え関係の推定（指示書 §6.2）の DB 側。
-- ノートが active になった時・active のまま本文が変わった時に pgmq のキューへ積み、ワーカー（src/jobs/）が処理する。
-- キュー関連の関数は PostgREST に公開しない jobs スキーマに置く（public の SECURITY DEFINER 許可リスト AC-091 を増やさない）。

create extension if not exists pgmq;
select pgmq.create('relation_inference');

create schema if not exists jobs;
revoke all on schema jobs from public, anon, authenticated;

-- 推定ジョブの失敗記録（AC-059）
create table jobs.relation_job_failure (
  id bigint generated always as identity primary key,
  note_id uuid not null,
  attempts integer not null,
  error text not null,
  failed_at timestamptz not null default now()
);

create function jobs.enqueue_relation_inference() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and (
       tg_op = 'INSERT'
       or old.status is distinct from 'active'
       or new.title is distinct from old.title
       or new.body is distinct from old.body
     ) then
    perform pgmq.send('relation_inference', jsonb_build_object('note_id', new.id));
  end if;
  return null;
end;
$$;
revoke execute on function jobs.enqueue_relation_inference() from public, anon, authenticated;

create trigger notes_enqueue_relation_inference after insert or update on public.notes
for each row execute function jobs.enqueue_relation_inference();

-- AI の提案は同じノートの組（向きを問わない）に1件まで。再試行・再保存で重複させない（AC-114 / AS-043）
create unique index note_relation_ai_pair_uniq on public.note_relation
  (least(from_note_id, to_note_id), greatest(from_note_id, to_note_id))
  where proposed_by = 'ai';

-- 自分が処理できる（両方のノートを編集できる）未承認の提案。RLS の下で動く（SECURITY INVOKER）
create function public.pending_relations()
returns setof public.note_relation
language sql stable security invoker
set search_path = ''
as $$
  select r.* from public.note_relation r
  where r.state = 'proposed'
    and public.can_edit_note(r.from_note_id)
    and public.can_edit_note(r.to_note_id)
  order by r.created_at desc
$$;
revoke execute on function public.pending_relations() from public, anon;
grant execute on function public.pending_relations() to authenticated;

-- 取りこぼし回収: pg_cron が毎分ワーカーの URL を呼ぶ。URL と秘密はデプロイ時に jobs.configure_worker で設定する
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create function jobs.configure_worker(p_url text, p_secret text) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'ankb-relation-worker';
  perform cron.schedule(
    'ankb-relation-worker', '* * * * *',
    format(
      $cmd$select net.http_post(url := %L, headers := jsonb_build_object('x-ankb-worker-secret', %L), body := '{}'::jsonb)$cmd$,
      p_url, p_secret
    )
  );
end;
$$;
revoke execute on function jobs.configure_worker(text, text) from public, anon, authenticated;
