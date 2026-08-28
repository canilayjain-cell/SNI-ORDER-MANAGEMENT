"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/lib/toast";
import type { Profile, Role } from "@/lib/types";

export default function ManageUsersPage() {
  const supabase = createClient();
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("profiles").select("*").order("created_at");
    if (error) { toast("Could not load users: " + error.message); setLoading(false); return; }
    setUsers(data as Profile[]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function changeRole(id: string, role: Role) {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) { toast("Could not update role: " + error.message); return; }
    toast("Role updated");
    load();
  }

  return (
    <div className="page-inner">
      <div className="card">
        <div className="card-head">Manage users</div>
        <p style={{ fontSize: 12.5, color: "var(--g600)", marginBottom: 14 }}>
          New accounts are created in the Supabase dashboard (Authentication → Add user). Assign their role here
          once they appear in this list — new accounts default to Sales until you change it.
        </p>
        {loading ? (
          <div className="mgr-empty">Loading...</div>
        ) : (
          <div className="mgr-list" style={{ maxHeight: "none" }}>
            {users.map((u) => (
              <div className="mgr-item" key={u.id}>
                <span>
                  {u.full_name || u.email} <span style={{ color: "var(--g600)", fontSize: 11 }}>({u.email})</span>
                </span>
                <select
                  className="status-sel"
                  value={u.role}
                  disabled={u.id === me?.id}
                  onChange={(e) => changeRole(u.id, e.target.value as Role)}
                >
                  <option value="sales">Sales</option>
                  <option value="factory">Factory</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
