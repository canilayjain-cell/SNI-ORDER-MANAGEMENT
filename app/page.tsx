import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_ROUTE } from "@/lib/roles";
import type { Role } from "@/lib/types";

// The root route only ever redirects — either to /login, or to the
// signed-in user's default tab for their role.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const role = (profile?.role as Role) || "sales";
  redirect(DEFAULT_ROUTE[role]);
}
