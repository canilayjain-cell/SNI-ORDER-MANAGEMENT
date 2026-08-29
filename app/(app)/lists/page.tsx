"use client";
import { useState } from "react";
import { useOptionLists } from "@/lib/hooks/useOptionLists";
import { toast } from "@/lib/toast";
import type { OptionRow } from "@/lib/types";

export default function ManageListsPage() {
  const { rows, addOption, removeOption } = useOptionLists();
  const [inThick, setInThick] = useState("");
  const [inPanel, setInPanel] = useState("");
  const [inParty, setInParty] = useState("");
  const [inSales, setInSales] = useState("");

  async function handleAdd(type: "thick" | "panel" | "party" | "salesperson", value: string, clear: () => void) {
    const v = value.trim();
    if (!v) return;
    const err = await addOption(type, v);
    if (err) { toast("Could not add: " + err.message); return; }
    clear();
    toast(`"${v}" added`);
  }

  async function handleRemove(row: OptionRow) {
    const err = await removeOption(row.id);
    if (err) { toast("Could not remove: " + err.message); return; }
    toast("Removed");
  }

  const thickRows = rows.filter((r) => r.list_type === "thick");
  const panelRows = rows.filter((r) => r.list_type === "panel");
  const partyRows = rows.filter((r) => r.list_type === "party");
  const salesRows = rows.filter((r) => r.list_type === "salesperson");

  return (
    <div className="page-inner">
      <div className="mgr-grid">
        <div className="card">
          <div className="card-head">Thickness options</div>
          <ListBlock rows={thickRows} onRemove={handleRemove} />
          <div className="add-row">
            <input type="text" placeholder="e.g. 10mm" value={inThick} onChange={(e) => setInThick(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("thick", inThick, () => setInThick(""))}>Add</button>
          </div>
        </div>
        <div className="card">
          <div className="card-head">Panel options</div>
          <ListBlock rows={panelRows} onRemove={handleRemove} />
          <div className="add-row">
            <input type="text" placeholder="e.g. Sunboard" value={inPanel} onChange={(e) => setInPanel(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("panel", inPanel, () => setInPanel(""))}>Add</button>
          </div>
        </div>
        <div className="card">
          <div className="card-head">Salespeople (order placed by)</div>
          <ListBlock rows={salesRows} onRemove={handleRemove} />
          <div className="add-row">
            <input type="text" placeholder="e.g. Ramesh" value={inSales} onChange={(e) => setInSales(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("salesperson", inSales, () => setInSales(""))}>Add</button>
          </div>
        </div>
        <div className="card" style={{ gridColumn: "1/-1" }}>
          <div className="card-head">Party list</div>
          <ListBlock rows={partyRows} onRemove={handleRemove} />
          <div className="add-row">
            <input type="text" placeholder="New party name..." value={inParty} onChange={(e) => setInParty(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("party", inParty, () => setInParty(""))}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ListBlock({ rows, onRemove }: { rows: OptionRow[]; onRemove: (r: OptionRow) => void }) {
  if (!rows.length) return <div className="mgr-empty">No items yet.</div>;
  return (
    <div className="mgr-list">
      {rows.map((r) => (
        <div className="mgr-item" key={r.id}>
          <span>{r.value}</span>
          <button className="mgr-del" onClick={() => onRemove(r)}>✕</button>
        </div>
      ))}
    </div>
  );
}
