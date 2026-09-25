// @covers AC-001, AC-003, AC-133
import { LoginForm } from "./login-form";
import { safeNextPath } from "@/lib/safe-next";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main>
      <h1>ankb にログイン</h1>
      <LoginForm next={safeNextPath(next)} />
    </main>
  );
}
