"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/lib/toast";
import { fmtDate } from "@/lib/format";
import type { RawMaterial, RawMaterialStatus } from "@/lib/types";
import { Plus, RefreshCw } from "lucide-react";

const STATUSES: { value: RawMaterialStatus; label: string; badge: string }[] = [
  { value: "order_placed", label: "Order placed", badge: "bn" },
  { value: "in_dispatch", label: "In dispatch", badge: "ba" },
  { value: "delivered", label: "Delivered", badge: "bg" },
];
const COMPLETED = "completed";
const UNITS = ["Pcs", "Sheets", "Kg", "Ltr", "Mtr", "Sqft", "Box"];

export default function RawMaterialsPage() {
  const supabase = createClient();
  const { profile } = useAuth();
  const [rows, setRows] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [material, setMaterial] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState(UNITS[0]);
  const [neededBy, setNeededBy] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("raw_materials").select("*").order("created_at", { ascending: false });
    if (error) { toast("Could not load raw materials: " + error.message); setLoading(false); return; }
    setRows(data as RawMaterial[]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addRow() {
    const name = material.trim();
    if (!name) { alert("Please enter the raw material."); return; }
    if (!(parseFloat(quantity) > 0)) { alert("Please enter a valid quantity."); return; }
    setSaving(true);
    const { error } = await supabase.from("raw_materials").insert({
      material: name,
      quantity: parseFloat(quantity),
      unit,
      needed_by: neededBy || null,
      notes: notes.trim() || null,
      requested_by_name: profile?.full_name || profile?.email || null,
    });
    setSaving(false);
    if (error) { toast("Could not add: " + error.message); return; }
    setMaterial(""); setQuantity(""); setNeededBy(""); setNotes("");
    toast(`"${name}" added`);
    load();
  }

  async function changeStatus(row: RawMaterial, status: string) {
    // Completed rows are not kept: this table only holds open requirements
    if (status === COMPLETED) {
      if (!window.confirm(`Mark "${row.material}" as completed?\n\nThis permanently deletes it from the list.`)) return;
      const { error } = await supabase.from("raw_materials").delete().eq("id", row.id);
      if (error) { toast("Could not complete: " + error.message); return; }
      toast(`"${row.material}" completed and removed`);
      load();
      return;
    }
    const { error } = await supabase.from("raw_materials").update({ status }).eq("id", row.id);
    if (error) { toast("Could not update status: " + error.message); return; }
    toast("Status updated");
    load();
  }

  return (
    <div className="page-inner">
      <div className="card">
        <div className="card-head">Add raw material requirement</div>
        <div className="g3">
          <div className="field">
            <label>Raw material <span className="req">*</span></label>
            <input type="text" placeholder="e.g. Mica sheet 1mm" value={material} onChange={(e) => setMaterial(e.target.value)} />
          </div>
          <div className="field">
            <label>Quantity <span className="req">*</span></label>
            <input type="number" min="0" step="any" placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="field">
            <label>Unit <span className="req">*</span></label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="g2">
          <div className="field">
            <label>Needed by</label>
            <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </div>
          <div className="field">
            <label>Notes</label>
            <input type="text" placeholder="Supplier, size, colour..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary" onClick={addRow} disabled={saving}>
          {saving ? <span className="spin" /> : <Plus size={14} />}
          {saving ? "Saving..." : "Add"}
        </button>
      </div>

      <div className="card">
        <div className="card-head">
          <span>Raw material requirements</span>
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => load()}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <span className="badge bb">Open: {rows.length}</span>
          {STATUSES.map((s) => (
            <span className={`badge ${s.badge}`} key={s.value}>
              {s.label}: {rows.filter((r) => r.status === s.value).length}
            </span>
          ))}
        </div>
        {loading ? (
          <div className="mgr-empty">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="mgr-empty">No open raw material requirements.</div>
        ) : (
          <div className="mgr-list" style={{ maxHeight: "none" }}>
            {rows.map((r) => (
              <div className="mgr-item" key={r.id}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b>{r.material}</b> · {r.quantity} {r.unit}
                  <br />
                  <span style={{ fontSize: 11, color: "var(--g600)" }}>
                    {[
                      fmtDate(r.created_at),
                      r.requested_by_name && `by ${r.requested_by_name}`,
                      r.needed_by && `needed by ${fmtDate(r.needed_by)}`,
                      r.notes,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <select
                  className="status-sel"
                  value={r.status}
                  aria-label={`Status of ${r.material}`}
                  onChange={(e) => changeStatus(r, e.target.value)}
                >
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  <option value={COMPLETED}>Completed</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
