-- @covers AC-027, AC-031, AC-033, AC-034, AC-036, AC-100
-- @assumption AS-011
-- @assumption AS-014
-- @assumption AS-039
-- @assumption AS-070
-- 検索パイプライン（指示書 §6.1）の DB 側。検索関数はすべて SECURITY INVOKER とし、呼び出し者の RLS 下で動く（AC-100）。
-- 日本語全文検索は PGroonga（AS-011）。ベクトル検索は pgvector の HNSW。

create extension if not exists pgroonga with schema extensions;

create index note_chunk_content_pgroonga on public.note_chunk using pgroonga (content);
create index note_chunk_embedding_hnsw on public.note_chunk using hnsw (embedding extensions.vector_cosine_ops);

-- 全文検索。p_query は PGroonga のクエリ構文（アプリ側で各語をフレーズとして引用済み）
create function public.search_chunks_fts(p_query text, p_limit integer default 50)
returns table (chunk_id uuid, note_id uuid, content text, score double precision)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.note_id, c.content, pgroonga_score(c.tableoid, c.ctid)::double precision
  from public.note_chunk c
  join public.notes n on n.id = c.note_id
  where c.content &@~ p_query
    and n.status <> 'archived'
    -- 下書きはオーナー本人の検索にだけ出す（§4.2）
    and (n.status <> 'draft' or n.owner_id = (select auth.uid()))
  order by 4 desc, c.id
  limit least(greatest(p_limit, 1), 200)
$$;

-- ベクトル検索。p_embedding は '[0.1,0.2,...]' 形式の文字列（PostgREST 経由で渡すため）
create function public.search_chunks_vector(p_embedding text, p_limit integer default 50, p_min_similarity double precision default 0.3)
returns table (chunk_id uuid, note_id uuid, content text, score double precision)
language sql stable security invoker
set search_path = public, extensions
as $$
  select c.id, c.note_id, c.content, (1 - (c.embedding <=> p_embedding::vector))::double precision
  from public.note_chunk c
  join public.notes n on n.id = c.note_id
  where c.embedding is not null
    and 1 - (c.embedding <=> p_embedding::vector) >= p_min_similarity
    and n.status <> 'archived'
    and (n.status <> 'draft' or n.owner_id = (select auth.uid()))
  order by c.embedding <=> p_embedding::vector, c.id
  limit least(greatest(p_limit, 1), 200)
$$;

revoke execute on function public.search_chunks_fts(text, integer) from public, anon;
revoke execute on function public.search_chunks_vector(text, integer, double precision) from public, anon;
grant execute on function public.search_chunks_fts(text, integer) to authenticated;
grant execute on function public.search_chunks_vector(text, integer, double precision) to authenticated;
