"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOptionLists } from "@/lib/hooks/useOptionLists";
import { resizeImageToBlob } from "@/lib/image";
import { uploadToBucket } from "@/lib/storage";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/lib/toast";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, Save, RotateCcw, X, Plus, Trash2 } from "lucide-react";

interface FormPhoto { blob: Blob; previewUrl: string }

interface OrderItem {
  thick: string;
  panel: string;
  length: string;
  breadth: string;
  qty: string;
  design: "2D" | "3D";
}

const blankItem = (): OrderItem => ({ thick: "", panel: "", length: "", breadth: "", qty: "1", design: "2D" });

function itemSizeInfo(item: OrderItem) {
  const l = parseFloat(item.length) || 0;
  const b = parseFloat(item.breadth) || 0;
  const q = parseInt(item.qty, 10) || 1;
  if (l > 0 && b > 0) {
    const area = (l * b) / 92903;
    return { show: true, sizeMm: `${l} × ${b} mm`, each: `${area.toFixed(3)} sqft`, total: `${(area * q).toFixed(3)} sqft` };
  }
  return { show: false, sizeMm: "", each: "", total: "" };
}

export default function NewOrderPage() {
  const { profile } = useAuth();
  const { thickOpts, panelOpts, partyOpts, addOption, reload } = useOptionLists();
  const router = useRouter();
  const supabase = createClient();

  const [party, setParty] = useState("");
  const [showNewParty, setShowNewParty] = useState(false);
  const [newPartyName, setNewPartyName] = useState("");
  const [items, setItems] = useState<OrderItem[]>([blankItem()]);
  const [delivery, setDelivery] = useState("");
  const [reminderDays, setReminderDays] = useState("2");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  const [saving, setSaving] = useState(false);

  const today = useMemo(
    () => new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    []
  );

  function updateItem(i: number, patch: Partial<OrderItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((prev) => [...prev, blankItem()]);
  }

  function removeItem(i: number) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  const reminderInfo = useMemo(() => {
    if (!delivery) return null;
    const rd = parseInt(reminderDays, 10);
    const d = new Date(delivery);
    const r = new Date(d);
    r.setDate(r.getDate() - rd);
    const fmt = (dt: Date) => dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    return `Reminder set for ${fmt(r)} — ${rd} day${rd > 1 ? "s" : ""} before delivery on ${fmt(d)}`;
  }, [delivery, reminderDays]);

  async function handlePhotoInput(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        const resized = await resizeImageToBlob(f, 1000, 0.72);
        setPhotos((prev) => [...prev, resized]);
      } catch {
        toast("Could not load that photo");
      }
    }
  }

  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleAddParty() {
    const nm = newPartyName.trim();
    if (!nm) return;
    const err = await addOption("party", nm);
    if (err) { toast("Could not add: " + err.message); return; }
    setParty(nm);
    setShowNewParty(false);
    setNewPartyName("");
    toast(`"${nm}" added`);
  }

  function resetForm() {
    setParty(""); setItems([blankItem()]); setDelivery(""); setReminderDays("2");
    setNotes(""); setPhotos([]); setShowNewParty(false);
  }

  async function handleSave() {
    if (!party || party === "NEW") { alert("Please select a party."); return; }
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const tag = items.length > 1 ? ` for item ${i + 1}` : "";
      if (!it.thick) { alert(`Please select thickness${tag}.`); return; }
      if (!it.panel) { alert(`Please select panel${tag}.`); return; }
      if (!it.length || !it.breadth) { alert(`Please enter length and breadth${tag}.`); return; }
    }
    if (!delivery) { alert("Please select a delivery date."); return; }

    setSaving(true);
    try {
      const photoUrls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const path = `${profile?.id}/${Date.now()}-${i}.jpg`;
        const url = await uploadToBucket("reference-photos", path, photos[i].blob);
        photoUrls.push(url);
      }

      const { data, error } = await supabase.rpc("place_order_multi", {
        p_party: party,
        p_delivery: delivery,
        p_reminder_days: parseInt(reminderDays, 10),
        p_notes: notes,
        p_photo_urls: photoUrls,
        p_items: items.map((it) => ({
          thick: it.thick,
          panel: it.panel,
          length: parseFloat(it.length),
          breadth: parseFloat(it.breadth),
          qty: parseInt(it.qty, 10) || 1,
          design: it.design,
        })),
      });
      if (error) throw error;
      const rows = (data as { order_no: string }[]) || [];
      const orderNo = rows[0]?.order_no ?? "";

      resetForm();
      toast(
        rows.length === 1
          ? `Order ${orderNo} placed and sent to the floor queue`
          : `Order ${orderNo} placed with ${rows.length} items and sent to the floor queue`
      );
      router.push("/floor");
    } catch (e: any) {
      toast("Save failed: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-inner">
      <div className="card">
        <div className="card-head">Order reference</div>
        <div className="g2">
          <div className="field">
            <label>Order number</label>
            <div className="order-no-box">Assigned automatically on save</div>
          </div>
          <div className="field">
            <label>Order date</label>
            <input type="text" readOnly value={today} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">Party details</div>
        <div className="g1">
          <div className="field">
            <label>Select party</label>
            <select
              value={party}
              onChange={(e) => {
                setParty(e.target.value);
                setShowNewParty(e.target.value === "NEW");
              }}
            >
              <option value="">— choose party —</option>
              {partyOpts.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value="NEW">+ Add new party</option>
            </select>
            {partyOpts.length === 0 && <span className="field-hint">No parties yet — add one below.</span>}
          </div>
        </div>
        {showNewParty && (
          <div className="add-row">
            <input
              type="text"
              placeholder="New party name..."
              value={newPartyName}
              onChange={(e) => setNewPartyName(e.target.value)}
            />
            <button className="btn btn-sm btn-primary" onClick={handleAddParty}>Add</button>
          </div>
        )}
      </div>

      {items.map((it, idx) => {
        const si = itemSizeInfo(it);
        return (
          <div className="card" key={idx}>
            <div className="card-head">
              <span>Material &amp; size{items.length > 1 ? ` — item ${idx + 1}` : ""}</span>
              <span style={{ flex: 1 }} />
              {items.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm btn-icon"
                  title="Remove this item"
                  onClick={() => removeItem(idx)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <div className="g2">
              <div className="field">
                <label>Thickness</label>
                <select value={it.thick} onChange={(e) => updateItem(idx, { thick: e.target.value })}>
                  <option value="">Select...</option>
                  {thickOpts.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Panel used</label>
                <select value={it.panel} onChange={(e) => updateItem(idx, { panel: e.target.value })}>
                  <option value="">Select...</option>
                  {panelOpts.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <div className="g3">
              <div className="field">
                <label>Length (mm)</label>
                <input type="number" min="0" placeholder="0" value={it.length} onChange={(e) => updateItem(idx, { length: e.target.value })} />
              </div>
              <div className="field">
                <label>Breadth (mm)</label>
                <input type="number" min="0" placeholder="0" value={it.breadth} onChange={(e) => updateItem(idx, { breadth: e.target.value })} />
              </div>
              <div className="field">
                <label>Quantity</label>
                <input type="number" min="1" value={it.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} />
              </div>
            </div>
            {si.show && (
              <div className="size-strip">
                <div className="ss"><span>Size</span><span>{si.sizeMm}</span></div>
                <div className="ss"><span>Area / piece</span><span>{si.each}</span></div>
                <div className="ss"><span>Total area</span><span>{si.total}</span></div>
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--g600)", textTransform: "uppercase", letterSpacing: ".07em", display: "block", marginBottom: 10 }}>Design type</label>
              <div className="design-cards">
                <div className={`dc ${it.design === "2D" ? "active" : ""}`} onClick={() => updateItem(idx, { design: "2D" })}>2D</div>
                <div className={`dc ${it.design === "3D" ? "active" : ""}`} onClick={() => updateItem(idx, { design: "3D" })}>3D</div>
              </div>
            </div>
          </div>
        );
      })}

      <button type="button" className="btn btn-sm" style={{ marginBottom: 16 }} onClick={addItem}>
        <Plus size={13} /> Add another item
      </button>

      <div className="card">
        <div className="card-head">Delivery date &amp; reminder</div>
        <div className="g2">
          <div className="field">
            <label>Expected delivery date</label>
            <input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          </div>
          <div className="field">
            <label>Remind me</label>
            <select value={reminderDays} onChange={(e) => setReminderDays(e.target.value)}>
              <option value="1">1 day before</option>
              <option value="2">2 days before</option>
              <option value="3">3 days before</option>
              <option value="7">1 week before</option>
            </select>
          </div>
        </div>
        {reminderInfo && <div className="rem-box">{reminderInfo}</div>}
      </div>

      <div className="card">
        <div className="card-head">Reference photos (shown to the factory floor)</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <label className="btn btn-sm">
            <Camera size={13} /> Camera
            <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => handlePhotoInput(e.target.files)} />
          </label>
          <label className="btn btn-sm">
            <ImagePlus size={13} /> Gallery
            <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => handlePhotoInput(e.target.files)} />
          </label>
        </div>
        <div className="photo-grid">
          {photos.map((p, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={p.previewUrl} className="photo-thumb" alt={`Photo ${i + 1}`} onClick={() => removePhoto(i)} title="Click to remove" />
              <button
                onClick={() => removePhoto(i)}
                style={{ position: "absolute", top: -6, right: -6, background: "#1a1a18", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">Notes</div>
        <textarea rows={3} placeholder="Special instructions, finishing details, colour codes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="btn-group">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spin" /> : <Save size={14} />}
          {saving ? "Saving..." : "Place order"}
        </button>
        <button className="btn" onClick={resetForm}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>
    </div>
  );
}
