"use client";
// @covers AC-004, AC-129
import { logout } from "./actions";
import { AUTH_CHANNEL } from "@/webmcp/provider";

/** ログアウト。別タブの WebMCP 登録も解除させる */
export function LogoutButton() {
  return (
    <form
      action={logout}
      onSubmit={() => {
        if (typeof BroadcastChannel !== "undefined") {
          const c = new BroadcastChannel(AUTH_CHANNEL);
          c.postMessage("logout");
          c.close();
        }
      }}
    >
      <button type="submit" className="secondary">
        ログアウト
      </button>
    </form>
  );
}
