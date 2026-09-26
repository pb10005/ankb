-- @covers AC-049, AC-059
-- @assumption AS-076
-- 推定ジョブはサービスロールで動く（指示書 §5.3）。キューと失敗記録への権限をサービスロールに限って与える。
-- キューのテーブルは API のロール（anon / authenticated）からは触れない（pgmq_public を有効にしても露出しない）
revoke all on all tables in schema pgmq from anon, authenticated;
grant usage on schema pgmq to service_role;
grant select, insert, update, delete on all tables in schema pgmq to service_role;
grant usage on all sequences in schema pgmq to service_role;
grant execute on all functions in schema pgmq to service_role;
grant usage on schema jobs to service_role;
grant insert, select on jobs.relation_job_failure to service_role;
