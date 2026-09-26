// @covers AC-071
// @assumption AS-024
// OAuth の同意画面。外部エージェント（Claude Code など）が ankb を自分の権限で使うことを許可する
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { decideAction } from "./actions";

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string; error?: string }> }) {
  const { authorization_id: id = "", error } = await searchParams;
  const { supabase } = await requireUser(`/oauth/consent?authorization_id=${encodeURIComponent(id)}`);
  const { data, error: detailError } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (detailError || !data) {
    return (
      <main>
        <h1>接続の許可</h1>
        <p role="alert" className="error">
          この接続リクエストは無効か、期限が切れています。
        </p>
      </main>
    );
  }
  if (!("authorization_id" in data)) redirect(data.redirect_url);
  return (
    <main>
      <h1>接続の許可</h1>
      {error && (
        <p role="alert" className="error">
          処理できませんでした。もう一度お試しください。
        </p>
      )}
      <p>
        「{data.client.name}」が、あなたの権限で ankb のノートを検索・閲覧・作成できるようにします。
        承認や公開範囲の変更はできません。
      </p>
      <p>
        許可すると <strong data-testid="redirect-host">{new URL(data.redirect_uri).host}</strong> に戻ります。
        心当たりのない接続先なら許可しないでください。
      </p>
      <form action={decideAction} className="actions">
        <input type="hidden" name="authorization_id" value={data.authorization_id} />
        <button type="submit" name="decision" value="approve">
          許可する
        </button>
        <button type="submit" name="decision" value="deny" className="secondary">
          許可しない
        </button>
      </form>
    </main>
  );
}
