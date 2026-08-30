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

type Unit = "mm" | "in" | "ft";

interface OrderItem {
  thick: string;
  panel: string;
  length: string;
  breadth: string;
  qty: string;
  unit: Unit;
  design: "2D" | "3D";
}

const IN_TO_MM = 25.4;
const FT_TO_MM = 304.8;
// 1 sq ft = 92903.04 sq mm
const SQMM_PER_SQFT = 92903.04;

const UNIT_LABEL: Record<Unit, string> = { mm: "mm", in: "in", ft: "ft" };

const blankItem = (): OrderItem => ({ thick: "", panel: "", length: "", breadth: "", qty: "1", unit: "mm", design: "2D" });

// Read a length input in the item's chosen unit and return it in millimetres.
function toMm(value: string, unit: Unit): number {
  const n = parseFloat(value) || 0;
  if (unit === "in") return n * IN_TO_MM;
  if (unit === "ft") return n * FT_TO_MM;
  return n;
}

function itemSizeInfo(item: OrderItem) {
  const lmm = toMm(item.length, item.unit);
  const bmm = toMm(item.breadth, item.unit);
  const q = parseInt(item.qty, 10) || 1;
  if (lmm > 0 && bmm > 0) {
    const area = (lmm * bmm) / SQMM_PER_SQFT;
    return {
      show: true,
      sizeMm: `${lmm.toFixed(1)} × ${bmm.toFixed(1)} mm`,
      entered: item.unit !== "mm" ? `${item.length} × ${item.breadth} ${UNIT_LABEL[item.unit]}` : null,
      each: `${area.toFixed(3)} sqft`,
      total: `${(area * q).toFixed(3)} sqft`,
    };
  }
  return { show: false, sizeMm: "", entered: null as string | null, each: "", total: "" };
}

export default function NewOrderPage() {
  const { profile } = useAuth();
  const { thickOpts, panelOpts, partyOpts, salespersonOpts, addOption } = useOptionLists();
  const router = useRouter();
  const supabase = createClient();

  const [party, setParty] = useState("");
  const [partyOpen, setPartyOpen] = useState(false);
  const [placedBy, setPlacedBy] = useState("");
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

  const partyQuery = party.trim().toLowerCase();
  const partyMatches = useMemo(
    () => partyOpts.filter((p) => p.toLowerCase().includes(partyQuery)).slice(0, 8),
    [partyOpts, partyQuery]
  );
  const partyIsKnown = partyOpts.some((p) => p.toLowerCase() === partyQuery);

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

  function resetForm() {
    setParty(""); setPartyOpen(false); setPlacedBy(""); setItems([blankItem()]); setDelivery(""); setReminderDays("2");
    setNotes(""); setPhotos([]);
  }

  async function handleSave() {
    const partyName = party.trim();
    if (!partyName) { alert("Please enter a party name."); return; }
    if (!placedBy) { alert("Please select who placed this order."); return; }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const tag = items.length > 1 ? ` for item ${i + 1}` : "";
      if (!it.thick) { alert(`Please select thickness${tag}.`); return; }
      if (!it.panel) { alert(`Please select panel${tag}.`); return; }
      if (!(parseFloat(it.length) > 0)) { alert(`Please enter a valid length${tag}.`); return; }
      if (!(parseFloat(it.breadth) > 0)) { alert(`Please enter a valid breadth${tag}.`); return; }
      if (!(parseInt(it.qty, 10) > 0)) { alert(`Please enter a valid quantity${tag}.`); return; }
    }
    if (!delivery) { alert("Please select a delivery date."); return; }
    if (!notes.trim()) { alert("Please add notes / instructions for the floor."); return; }
    if (photos.length === 0) { alert("Please add at least one reference photo."); return; }

    setSaving(true);
    try {
      // resolve the party: reuse the exact stored name if it already exists
      // (case-insensitive), otherwise create it on the fly
      const canonicalParty = partyOpts.find((p) => p.toLowerCase() === partyName.toLowerCase());
      const finalParty = canonicalParty ?? partyName;
      if (!canonicalParty) {
        const err = await addOption("party", finalParty);
        if (err && !/duplicate|unique/i.test(err.message)) {
          throw new Error("Could not add party: " + err.message);
        }
      }

      const photoUrls: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const path = `${profile?.id}/${Date.now()}-${i}.jpg`;
        const url = await uploadToBucket("reference-photos", path, photos[i].blob);
        photoUrls.push(url);
      }

      const { data, error } = await supabase.rpc("place_order_multi", {
        p_party: finalParty,
        p_placed_by: placedBy,
        p_delivery: delivery,
        p_reminder_days: parseInt(reminderDays, 10),
        p_notes: notes.trim(),
        p_photo_urls: photoUrls,
        p_items: items.map((it) => ({
          thick: it.thick,
          panel: it.panel,
          length: toMm(it.length, it.unit),
          breadth: toMm(it.breadth, it.unit),
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
        <div className="card-head">Party &amp; order details</div>
        <div className="g2">
          <div className="field combo">
            <label>Party <span className="req">*</span></label>
            <input
              type="text"
              placeholder="Type to search parties, or type a new name to add it…"
              value={party}
              onChange={(e) => { setParty(e.target.value); setPartyOpen(true); }}
              onFocus={() => setPartyOpen(true)}
              onBlur={() => setTimeout(() => setPartyOpen(false), 150)}
            />
            {partyOpen && (
              <div className="combo-list">
                {partyMatches.map((p) => (
                  <div
                    key={p}
                    className="combo-opt"
                    onMouseDown={() => { setParty(p); setPartyOpen(false); }}
                  >
                    {p}
                  </div>
                ))}
                {partyQuery && !partyIsKnown && (
                  <div className="combo-opt create" onMouseDown={() => setPartyOpen(false)}>
                    + Add new party “{party.trim()}”
                  </div>
                )}
                {!partyQuery && partyMatches.length === 0 && (
                  <div className="combo-opt muted">Start typing a party name…</div>
                )}
                {partyQuery && partyMatches.length === 0 && partyIsKnown && (
                  <div className="combo-opt muted">No other matches</div>
                )}
              </div>
            )}
            {partyQuery && !partyIsKnown && (
              <span className="field-hint">“{party.trim()}” will be added as a new party on save.</span>
            )}
          </div>
          <div className="field">
            <label>Order placed by <span className="req">*</span></label>
            <select value={placedBy} onChange={(e) => setPlacedBy(e.target.value)}>
              <option value="">Select salesperson…</option>
              {salespersonOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {salespersonOpts.length === 0 && (
              <span className="field-hint">No salespeople added yet — an admin can add them under Manage lists.</span>
            )}
          </div>
        </div>
      </div>

      {items.map((it, idx) => {
        const si = itemSizeInfo(it);
        const unitLabel = UNIT_LABEL[it.unit];
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
                <label>Thickness <span className="req">*</span></label>
                <select value={it.thick} onChange={(e) => updateItem(idx, { thick: e.target.value })}>
                  <option value="">Select...</option>
                  {thickOpts.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Panel used <span className="req">*</span></label>
                <select value={it.panel} onChange={(e) => updateItem(idx, { panel: e.target.value })}>
                  <option value="">Select...</option>
                  {panelOpts.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, margin: "2px 0 10px" }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--g600)" }}>Measurement unit</label>
              <div className="seg">
                <button type="button" className={it.unit === "mm" ? "active" : ""} onClick={() => updateItem(idx, { unit: "mm" })}>MM</button>
                <button type="button" className={it.unit === "in" ? "active" : ""} onClick={() => updateItem(idx, { unit: "in" })}>Inches</button>
                <button type="button" className={it.unit === "ft" ? "active" : ""} onClick={() => updateItem(idx, { unit: "ft" })}>Ft</button>
              </div>
            </div>

            <div className="g3">
              <div className="field">
                <label>Length ({unitLabel}) <span className="req">*</span></label>
                <input type="number" min="0" step="any" placeholder="0" value={it.length} onChange={(e) => updateItem(idx, { length: e.target.value })} />
              </div>
              <div className="field">
                <label>Breadth ({unitLabel}) <span className="req">*</span></label>
                <input type="number" min="0" step="any" placeholder="0" value={it.breadth} onChange={(e) => updateItem(idx, { breadth: e.target.value })} />
              </div>
              <div className="field">
                <label>Quantity <span className="req">*</span></label>
                <input type="number" min="1" value={it.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} />
              </div>
            </div>
            {si.show && (
              <div className="size-strip">
                {si.entered && <div className="ss"><span>Entered</span><span>{si.entered}</span></div>}
                <div className="ss"><span>Size (mm)</span><span>{si.sizeMm}</span></div>
                <div className="ss"><span>Area / piece</span><span>{si.each}</span></div>
                <div className="ss"><span>Total area</span><span>{si.total}</span></div>
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--g600)", textTransform: "uppercase", letterSpacing: ".07em", display: "block", marginBottom: 10 }}>Design type <span className="req">*</span></label>
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
            <label>Expected delivery date <span className="req">*</span></label>
            <input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          </div>
          <div className="field">
            <label>Remind me <span className="req">*</span></label>
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
        <div className="card-head">Reference photos (shown to the factory floor) <span className="req">*</span></div>
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
        {photos.length === 0 && <span className="field-hint">At least one reference photo is required.</span>}
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
        <div className="card-head">Notes <span className="req">*</span></div>
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
