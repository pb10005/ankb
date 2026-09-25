-- @covers AC-002
-- @assumption AS-003
-- v1 のユーザーはシードでのみ作成する（サインアップ画面は無い）。パスワードはローカル・CI 専用。
create or replace function pg_temp.seed_user(p_id uuid, p_email text, p_name text, p_password text)
returns void language sql as $$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', p_name), now(), now(),
    '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), p_id, p_id::text, jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
$$;

select pg_temp.seed_user('11111111-1111-4111-8111-111111111111', 'misaki@example.com', '美咲', 'ankb-local-password');
select pg_temp.seed_user('22222222-2222-4222-8222-222222222222', 'kenta@example.com', '健太', 'ankb-local-password');
select pg_temp.seed_user('33333333-3333-4333-8333-333333333333', 'sho@example.com', '翔', 'ankb-local-password');
-- 権限シナリオ・出張規程シナリオ用（指示書 §9.1）。workspace・member・ノートは fixtures/ から npm run seed で投入する
select pg_temp.seed_user('44444444-4444-4444-8444-444444444444', 'yuki@example.com', '由紀（役員）', 'ankb-local-password');
select pg_temp.seed_user('55555555-5555-4555-8555-555555555555', 'outsider@example.com', '外部ユーザー', 'ankb-local-password');
