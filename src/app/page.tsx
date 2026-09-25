// @covers AC-001
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
