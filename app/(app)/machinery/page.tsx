"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/lib/toast";
import { canManageMachines } from "@/lib/roles";
import type { Machine, MachineStatus } from "@/lib/types";

const STATUSES: { value: MachineStatus; label: string; badge: string }[] = [
  { value: "working", label: "Working", badge: "bg" },
  { value: "not_working", label: "Not working", badge: "br" },
  { value: "in_service", label: "In service", badge: "ba" },
];

export default function MachineryPage() {
  const supabase = createClient();
  const { profile } = useAuth();
  const canManage = profile ? canManageMachines(profile.role) : false;
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("machines").select("*").order("created_at");
    if (error) { toast("Could not load machines: " + error.message); setLoading(false); return; }
    setMachines(data as Machine[]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addMachine() {
    const v = name.trim();
    if (!v) return;
    const { error } = await supabase.from("machines").insert({ name: v });
    if (error) {
      toast(error.code === "23505" ? `"${v}" is already in the list` : "Could not add: " + error.message);
      return;
    }
    setName("");
    toast(`"${v}" added`);
    load();
  }

  async function changeStatus(id: string, status: MachineStatus) {
    const { error } = await supabase.rpc("set_machine_status", { p_machine_id: id, p_status: status });
    if (error) { toast("Could not update status: " + error.message); return; }
    toast("Status updated");
    load();
  }

  async function removeMachine(m: Machine) {
    if (!window.confirm(`Remove "${m.name}" from the list?`)) return;
    const { error } = await supabase.from("machines").delete().eq("id", m.id);
    if (error) { toast("Could not remove: " + error.message); return; }
    toast("Removed");
    load();
  }

  return (
    <div className="page-inner">
      <div className="card">
        <div className="card-head">Machinery</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <span className="badge bn">Total: {machines.length}</span>
          {STATUSES.map((s) => (
            <span className={`badge ${s.badge}`} key={s.value}>
              {s.label}: {machines.filter((m) => m.status === s.value).length}
            </span>
          ))}
        </div>
        {loading ? (
          <div className="mgr-empty">Loading...</div>
        ) : machines.length === 0 ? (
          <div className="mgr-empty">No machines yet.</div>
        ) : (
          <div className="mgr-list" style={{ maxHeight: "none" }}>
            {machines.map((m) => (
              <div className="mgr-item" key={m.id}>
                <span style={{ flex: 1, minWidth: 0 }}>{m.name}</span>
                <select
                  className="status-sel"
                  value={m.status}
                  aria-label={`Status of ${m.name}`}
                  onChange={(e) => changeStatus(m.id, e.target.value as MachineStatus)}
                >
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                {canManage && (
                  <button className="mgr-del" aria-label={`Remove ${m.name}`} onClick={() => removeMachine(m)}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}
        {canManage && (
          <div className="add-row">
            <input
              type="text"
              placeholder="Machine name or number..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addMachine(); }}
            />
            <button className="btn btn-sm btn-primary" onClick={addMachine}>Add</button>
          </div>
        )}
      </div>
    </div>
  );
}
