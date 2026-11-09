"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOptionLists } from "@/lib/hooks/useOptionLists";
import { toast } from "@/lib/toast";
import { orderLabel } from "@/lib/format";
import { resizeImageToBlob } from "@/lib/image";
import { uploadToBucket } from "@/lib/storage";
import { askCustomThickness, fromMm, isCustomThickness, toMm, UNIT_LABEL, type Unit } from "@/lib/units";
import SearchSelect from "@/components/SearchSelect";
import type { FloorManager, Order } from "@/lib/types";
import { Camera, ImagePlus, Save, X } from "lucide-react";

// a value that has since been removed from its list must still show
const withCurrent = (current: string | null, options: string[]) =>
  current && !options.includes(current) ? [current, ...options] : options;

export default function EditOrderItem({ order, onClose, onSaved }: { order: Order; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const { rows, thickOpts, panelOpts, partyOpts, salespersonOpts, doorTypeOpts, designNumbersFor } = useOptionLists();
  const [floorManagers, setFloorManagers] = useState<FloorManager[]>([]);
  const [saving, setSaving] = useState(false);
  const [keptPhotos, setKeptPhotos] = useState((order.order_photos ?? []).map((p) => p.url));
  const [newPhotos, setNewPhotos] = useState<{ blob: Blob; previewUrl: string }[]>([]);
  const [form, setForm] = useState({
    party: order.party,
    placedBy: order.placed_by ?? "",
    unit: "in" as Unit,
    reminderDays: String(order.reminder_days),
    assignedTo: order.assigned_to ?? "",
    thick: order.thick,
    panel: order.panel,
    doorType: order.door_type ?? "",
    designNumber: order.design_number ?? "",
    length: fromMm(order.length_mm, "in"),
    breadth: fromMm(order.breadth_mm, "in"),
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

  function changeUnit(unit: Unit) {
    patch({
      unit,
      length: fromMm(toMm(form.length, form.unit), unit),
      breadth: fromMm(toMm(form.breadth, form.unit), unit),
    });
  }

  // an untouched size keeps its exact stored value, despite display rounding
  const lengthMm = form.length === fromMm(order.length_mm, form.unit) ? order.length_mm : toMm(form.length, form.unit);
  const breadthMm = form.breadth === fromMm(order.breadth_mm, form.unit) ? order.breadth_mm : toMm(form.breadth, form.unit);

  async function addPhotos(files: FileList | null) {
    for (const f of Array.from(files ?? [])) {
      try {
        const resized = await resizeImageToBlob(f, 1000, 0.72);
        setNewPhotos((prev) => [...prev, resized]);
      } catch {
        toast("Could not load that photo");
      }
    }
  }

  async function save() {
    if (!form.party.trim()) { alert("Please enter a party name."); return; }
    if (!form.placedBy) { alert("Please select who placed this order."); return; }
    if (!form.thick) { alert("Please select thickness."); return; }
    if (!form.panel) { alert("Please select panel."); return; }
    if (!(parseFloat(form.length) > 0)) { alert("Please enter a valid length."); return; }
    if (!(parseFloat(form.breadth) > 0)) { alert("Please enter a valid breadth."); return; }
    if (!(parseInt(form.qty, 10) > 0)) { alert("Please enter a valid quantity."); return; }
    if (!form.delivery) { alert("Please select a delivery date."); return; }
    const photoRequired = rows.some((r) => r.list_type === "door_type" && r.value === form.doorType && r.photo_required);
    if (photoRequired && keptPhotos.length + newPhotos.length === 0) { alert(`Please add a reference photo for ${form.doorType}.`); return; }
    setSaving(true);
    let uploaded: string[] = [];
    try {
      uploaded = await Promise.all(newPhotos.map((p, i) => uploadToBucket("reference-photos", `${order.id}/${Date.now()}-${i}.jpg`, p.blob)));
    } catch (e: any) {
      setSaving(false);
      toast("Could not upload photo: " + e.message);
      return;
    }
    const typedParty = form.party.trim();
    const { error } = await supabase.rpc("admin_edit_order_item", {
      p_order_id: order.id,
      p_assigned_to: form.assignedTo || null,
      p_thick: form.thick,
      p_panel: form.panel,
      p_door_type: form.doorType,
      p_design_number: form.designNumber,
      p_length: lengthMm,
      p_breadth: breadthMm,
      p_qty: parseInt(form.qty, 10),
      p_design: form.design,
      p_delivery: form.delivery,
      p_notes: form.notes,
      p_party: partyOpts.find((o) => o.toLowerCase() === typedParty.toLowerCase()) ?? typedParty,
      p_placed_by: form.placedBy,
      p_reminder_days: parseInt(form.reminderDays, 10),
      p_photo_urls: [...keptPhotos, ...uploaded],
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
            <label>Party <span className="req">*</span></label>
            <input type="text" list="edit-party-list" autoComplete="off" value={form.party} onChange={(e) => patch({ party: e.target.value })} />
            <datalist id="edit-party-list">
              {partyOpts.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>
          <div className="field">
            <label>Order placed by <span className="req">*</span></label>
            <select value={form.placedBy} onChange={(e) => patch({ placedBy: e.target.value })}>
              <option value="">Select salesperson…</option>
              {withCurrent(order.placed_by, salespersonOpts).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        {order.line_count > 1 && (
          <p style={{ fontSize: 12, color: "var(--g600)", margin: "-6px 0 14px" }}>Party and Order placed by apply to all {order.line_count} items. Everything below is for this item only.</p>
        )}
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
            <label>Remind me <span className="req">*</span></label>
            <select value={form.reminderDays} onChange={(e) => patch({ reminderDays: e.target.value })}>
              {Array.from(new Set(["1", "2", "3", "7", form.reminderDays])).map((d) => (
                <option key={d} value={d}>{d === "7" ? "1 week" : `${d} day${d === "1" ? "" : "s"}`} before</option>
              ))}
            </select>
          </div>
        </div>
        <div className="g2">
          <div className="field">
            <label>Thickness <span className="req">*</span></label>
            <select
              value={form.thick}
              onChange={(e) => {
                const thick = isCustomThickness(e.target.value) ? askCustomThickness() : e.target.value;
                if (thick !== null) patch({ thick });
              }}
            >
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "2px 0 10px" }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: "var(--g600)" }}>Measurement unit</label>
          <div className="seg">
            <button type="button" className={form.unit === "mm" ? "active" : ""} onClick={() => changeUnit("mm")}>MM</button>
            <button type="button" className={form.unit === "in" ? "active" : ""} onClick={() => changeUnit("in")}>Inches</button>
            <button type="button" className={form.unit === "ft" ? "active" : ""} onClick={() => changeUnit("ft")}>Ft</button>
          </div>
        </div>
        <div className="g3">
          <div className="field">
            <label>Length ({UNIT_LABEL[form.unit]}) <span className="req">*</span></label>
            <input type="number" min="0" step="any" value={form.length} onChange={(e) => patch({ length: e.target.value })} />
          </div>
          <div className="field">
            <label>Breadth ({UNIT_LABEL[form.unit]}) <span className="req">*</span></label>
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
          <label>Reference photos</label>
          <div style={{ display: "flex", gap: 8 }}>
            <label className="btn btn-sm">
              <Camera size={13} /> Camera
              <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="btn btn-sm">
              <ImagePlus size={13} /> Gallery
              <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {keptPhotos.length + newPhotos.length > 0 && (
            <div className="photo-grid">
              {keptPhotos.map((url) => (
                <Thumb key={url} src={url} onRemove={() => setKeptPhotos((prev) => prev.filter((u) => u !== url))} />
              ))}
              {newPhotos.map((p, i) => (
                <Thumb key={p.previewUrl} src={p.previewUrl} onRemove={() => setNewPhotos((prev) => prev.filter((_, idx) => idx !== i))} />
              ))}
            </div>
          )}
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

function Thumb({ src, onRemove }: { src: string; onRemove: () => void }) {
  return (
    <div style={{ position: "relative" }}>
      <img src={src} className="photo-thumb" alt="Reference" />
      <button
        type="button"
        aria-label="Remove photo"
        onClick={onRemove}
        style={{ position: "absolute", top: -6, right: -6, background: "#1a1a18", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
      >
        <X size={11} />
      </button>
    </div>
  );
}
