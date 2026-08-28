"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { Package } from "lucide-react";

export default function Nav({ profile }: { profile: Profile }) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <nav className="nav no-print">
      <div className="logo">
        <div className="logo-icon">
          <Package size={17} color="#fff" strokeWidth={2} />
        </div>
        SNI Order System
      </div>
      <div className="nav-right">
        <div className="user-block">
          <div className="user-id">
            <div className="user-name">{profile.full_name || profile.email}</div>
            <div className="user-role">{profile.role}</div>
          </div>
          <button className="btn btn-sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
