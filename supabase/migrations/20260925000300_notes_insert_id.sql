-- @covers AC-018
-- INSERT ... RETURNING では、SELECT ポリシーの can_view_note（STABLE）が挿入中の行を見られず失敗する。
-- アプリ側で id を採番して RETURNING を使わずに挿入できるよう、id 列の INSERT を許可する。
grant insert (id) on public.notes to authenticated;
