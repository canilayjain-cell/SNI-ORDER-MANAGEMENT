"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOptionLists } from "@/lib/hooks/useOptionLists";
import { toast } from "@/lib/toast";
import { orderLabel } from "@/lib/format";
import SearchSelect from "@/components/SearchSelect";
import type { FloorManager, Order } from "@/lib/types";
import { Save } from "lucide-react";

// a value that has since been removed from its list must still show
const withCurrent = (current: string | null, options: string[]) =>
  current && !options.includes(current) ? [current, ...options] : options;

export default function EditOrderItem({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const { thickOpts, panelOpts, doorTypeOpts, designNumbersFor } = useOptionLists();
  const [floorManagers, setFloorManagers] = useState<FloorManager[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    assignedTo: order.assigned_to ?? "",
    thick: order.thick,
    panel: order.panel,
    doorType: order.door_type ?? "",
    designNumber: order.design_number ?? "",
    length: String(order.length_mm),
    breadth: String(order.breadth_mm),
    qty: String(order.qty),
    design: order.design,
    delivery: order.delivery_date.slice(0, 10),
    notes: order.notes ?? "",
  });
  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  useEffect(() => {
    supabase.rpc("list_floor_managers").then(({ data, error }) => {
      if (error) { toast("Could not load floor managers: " + error.message); return; }
      setFloorManagers((data as FloorManager[]) || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const designOpts = withCurrent(form.designNumber || null, designNumbersFor(form.doorType));

  async function save() {
    if (!form.thick) { alert("Please select thickness."); return; }
    if (!form.panel) { alert("Please select panel."); return; }
    if (!(parseFloat(form.length) > 0)) { alert("Please enter a valid length."); return; }
    if (!(parseFloat(form.breadth) > 0)) { alert("Please enter a valid breadth."); return; }
    if (!(parseInt(form.qty, 10) > 0)) { alert("Please enter a valid quantity."); return; }
    if (!form.delivery) { alert("Please select a delivery date."); return; }
    setSaving(true);
    const { error } = await supabase.rpc("admin_edit_order_item", {
      p_order_id: order.id,
      p_assigned_to: form.assignedTo || null,
      p_thick: form.thick,
      p_panel: form.panel,
      p_door_type: form.doorType,
      p_design_number: form.designNumber,
      p_length: parseFloat(form.length),
      p_breadth: parseFloat(form.breadth),
      p_qty: parseInt(form.qty, 10),
      p_design: form.design,
      p_delivery: form.delivery,
      p_notes: form.notes,
    });
    setSaving(false);
    if (error) { toast("Could not save changes: " + error.message); return; }
    toast(`${orderLabel(order)} updated`);
    onSaved();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(20,20,18,.55)", overflowY: "auto", padding: 16 }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 640, margin: "24px auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="card-head">Edit {orderLabel(order)} — {order.party}</div>
        <div className="g2">
          <div className="field">
            <label>Order given to</label>
            <select value={form.assignedTo} onChange={(e) => patch({ assignedTo: e.target.value })}>
              <option value="">Not assigned</option>
              {floorManagers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Delivery date <span className="req">*</span></label>
            <input type="date" value={form.delivery} onChange={(e) => patch({ delivery: e.target.value })} />
          </div>
        </div>
        <div className="g2">
          <div className="field">
            <label>Thickness <span className="req">*</span></label>
            <select value={form.thick} onChange={(e) => patch({ thick: e.target.value })}>
              {withCurrent(form.thick, thickOpts).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Panel used <span className="req">*</span></label>
            <select value={form.panel} onChange={(e) => patch({ panel: e.target.value })}>
              {withCurrent(form.panel, panelOpts).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="g2">
          <div className="field">
            <label>Door type</label>
            <SearchSelect
              value={form.doorType}
              options={withCurrent(order.door_type, doorTypeOpts)}
              placeholder="Type or pick a door type…"
              emptyText="No door type matches"
              onChange={(doorType) => patch({ doorType, designNumber: designNumbersFor(doorType).includes(form.designNumber) ? form.designNumber : "" })}
            />
          </div>
          <div className="field">
            <label>Design number</label>
            <SearchSelect
              value={form.designNumber}
              options={designOpts}
              placeholder="Type or pick a design number…"
              emptyText="No design number matches"
              onChange={(designNumber) => patch({ designNumber })}
            />
          </div>
        </div>
        <div className="g3">
          <div className="field">
            <label>Length (mm) <span className="req">*</span></label>
            <input type="number" min="0" step="any" value={form.length} onChange={(e) => patch({ length: e.target.value })} />
          </div>
          <div className="field">
            <label>Breadth (mm) <span className="req">*</span></label>
            <input type="number" min="0" step="any" value={form.breadth} onChange={(e) => patch({ breadth: e.target.value })} />
          </div>
          <div className="field">
            <label>Quantity <span className="req">*</span></label>
            <input type="number" min="1" value={form.qty} onChange={(e) => patch({ qty: e.target.value })} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Design type</label>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            <button type="button" className={form.design === "2D" ? "active" : ""} onClick={() => patch({ design: "2D" })}>2D</button>
            <button type="button" className={form.design === "3D" ? "active" : ""} onClick={() => patch({ design: "3D" })}>3D</button>
          </div>
        </div>
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
        </div>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spin" /> : <Save size={14} />}
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
