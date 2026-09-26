// @covers AC-001, AC-136
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
