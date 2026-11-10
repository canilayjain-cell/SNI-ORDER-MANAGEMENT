"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useOptionLists } from "@/lib/hooks/useOptionLists";
import { resizeImageToBlob } from "@/lib/image";
import { uploadToBucket } from "@/lib/storage";
import { useAuth } from "@/components/AuthProvider";
import { usePhotoViewer } from "@/components/PhotoViewer";
import SearchSelect from "@/components/SearchSelect";
import { toast } from "@/lib/toast";
import { isWpcPanel, PRINTING_OPTIONS } from "@/lib/format";
import { askCustomThickness, isCustomThickness, toMm, UNIT_LABEL, type Unit } from "@/lib/units";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, Save, RotateCcw, X, Plus, Trash2 } from "lucide-react";
import type { FloorManager } from "@/lib/types";

interface FormPhoto { blob: Blob; previewUrl: string }

interface OrderItem {
  thick: string;
  panel: string;
  printing: string;
  assignedTo: string;
  photos: FormPhoto[];
  notes: string;
  doorType: string;
  designNumber: string;
  length: string;
  breadth: string;
  qty: string;
  unit: Unit;
  design: "2D" | "3D";
}

// 1 sq ft = 92903.04 sq mm
const SQMM_PER_SQFT = 92903.04;

const blankItem = (): OrderItem => ({ assignedTo: "", photos: [], notes: "", thick: "", panel: "", printing: "", doorType: "", designNumber: "", length: "", breadth: "", qty: "1", unit: "in", design: "2D" });

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
  const { rows: optionRows, thickOpts, panelOpts, partyOpts, salespersonOpts, doorTypeOpts, designNumberOpts, designNumbersFor, designPhotos, addOption } = useOptionLists();
  const router = useRouter();
  const supabase = createClient();
  const { open, viewer } = usePhotoViewer();

  const [party, setParty] = useState("");
  const [partyOpen, setPartyOpen] = useState(false);
  const [placedBy, setPlacedBy] = useState("");
  const [floorManagers, setFloorManagers] = useState<FloorManager[]>([]);
  const [items, setItems] = useState<OrderItem[]>([blankItem()]);
  const [delivery, setDelivery] = useState("");
  const [reminderDays, setReminderDays] = useState("2");
  const [saving, setSaving] = useState(false);

  const today = useMemo(
    () => new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
    []
  );

  // floor managers are logins (profiles with role 'floor_manager'); sales
  // accounts can't read profiles directly, so this goes through an RPC
  useEffect(() => {
    supabase.rpc("list_floor_managers").then(({ data, error }) => {
      if (error) { toast("Could not load floor managers: " + error.message); return; }
      setFloorManagers((data as FloorManager[]) || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const partyQuery = party.trim().toLowerCase();
  const partyMatches = useMemo(
    () => partyOpts.filter((p) => p.toLowerCase().includes(partyQuery)).slice(0, 8),
    [partyOpts, partyQuery]
  );
  const partyIsKnown = partyOpts.some((p) => p.toLowerCase() === partyQuery);

  const doorTypeRow = (value: string) => optionRows.find((r) => r.list_type === "door_type" && r.value === value);

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

  async function handlePhotoInput(itemIdx: number, files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        const resized = await resizeImageToBlob(f, 1000, 0.72);
        setItems((prev) => prev.map((it, idx) => (idx === itemIdx ? { ...it, photos: [...it.photos, resized] } : it)));
      } catch {
        toast("Could not load that photo");
      }
    }
  }
  function removePhoto(itemIdx: number, photoIdx: number) {
    setItems((prev) => prev.map((it, idx) => (idx === itemIdx ? { ...it, photos: it.photos.filter((_, j) => j !== photoIdx) } : it)));
  }

  function resetForm() {
    setParty(""); setPartyOpen(false); setPlacedBy(""); setItems([blankItem()]); setDelivery(""); setReminderDays("2");
  }

  async function handleSave() {
    const partyName = party.trim();
    if (!partyName) { alert("Please enter a party name."); return; }
    if (!placedBy) { alert("Please select who placed this order."); return; }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const tag = items.length > 1 ? ` for item ${i + 1}` : "";
      if (!it.assignedTo) { alert(`Please select the floor manager this is assigned to${tag}.`); return; }
      if (!it.thick) { alert(`Please select thickness${tag}.`); return; }
      if (!it.panel) { alert(`Please select panel${tag}.`); return; }
      if (isWpcPanel(it.panel) && !it.printing) { alert(`Please select printing${tag}.`); return; }
      if (!(parseFloat(it.length) > 0)) { alert(`Please enter a valid length${tag}.`); return; }
      if (!(parseFloat(it.breadth) > 0)) { alert(`Please enter a valid breadth${tag}.`); return; }
      if (!(parseInt(it.qty, 10) > 0)) { alert(`Please enter a valid quantity${tag}.`); return; }
      if (doorTypeRow(it.doorType)?.photo_required && it.photos.length === 0) { alert(`Please add a reference photo for ${it.doorType}${tag}.`); return; }
    }
    if (!delivery) { alert("Please select a delivery date."); return; }

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

      const itemPhotoUrls: string[][] = [];
      for (let i = 0; i < items.length; i++) {
        const urls: string[] = [];
        for (let j = 0; j < items[i].photos.length; j++) {
          const path = `${profile?.id}/${Date.now()}-${i}-${j}.jpg`;
          urls.push(await uploadToBucket("reference-photos", path, items[i].photos[j].blob));
        }
        itemPhotoUrls.push(urls);
      }

      const { data, error } = await supabase.rpc("place_order_multi", {
        p_party: finalParty,
        p_placed_by: placedBy,
        p_delivery: delivery,
        p_reminder_days: parseInt(reminderDays, 10),
        p_notes: "",
        p_photo_urls: [],
        p_items: items.map((it, i) => ({
          assigned_to: it.assignedTo,
          photo_urls: itemPhotoUrls[i],
          notes: it.notes.trim(),
          thick: it.thick,
          panel: it.panel,
          printing: isWpcPanel(it.panel) ? it.printing : "",
          door_type: it.doorType,
          design_number: it.designNumber,
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
        const designOpts = designNumbersFor(it.doorType);
        const photoRequired = !!doorTypeRow(it.doorType)?.photo_required;
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
                <label>Assigned to <span className="req">*</span></label>
                <select value={it.assignedTo} onChange={(e) => updateItem(idx, { assignedTo: e.target.value })}>
                  <option value="">Select floor manager…</option>
                  {floorManagers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                {floorManagers.length === 0 && (
                  <span className="field-hint">No floor managers yet — an admin can set a login&apos;s role to Floor manager under Manage users.</span>
                )}
              </div>
            </div>
            <div className="g2">
              <div className="field">
                <label>Thickness <span className="req">*</span></label>
                <select
                  value={it.thick}
                  onChange={(e) => {
                    const thick = isCustomThickness(e.target.value) ? askCustomThickness() : e.target.value;
                    if (thick !== null) updateItem(idx, { thick });
                  }}
                >
                  <option value="">Select...</option>
                  {it.thick && !thickOpts.includes(it.thick) && <option value={it.thick}>{it.thick}</option>}
                  {thickOpts.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Panel used <span className="req">*</span></label>
                <select value={it.panel} onChange={(e) => updateItem(idx, { panel: e.target.value, printing: isWpcPanel(e.target.value) ? it.printing : "" })}>
                  <option value="">Select...</option>
                  {panelOpts.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            {isWpcPanel(it.panel) && (
              <div className="g2">
                <div className="field">
                  <label>Printing <span className="req">*</span></label>
                  <select value={it.printing} onChange={(e) => updateItem(idx, { printing: e.target.value })}>
                    <option value="">Select...</option>
                    {PRINTING_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div className="g2">
              <div className="field">
                <label>Door type</label>
                <SearchSelect
                  value={it.doorType}
                  options={doorTypeOpts}
                  placeholder="Type or pick a door type…"
                  emptyText="No door type matches"
                  onChange={(doorType) => {
                    const defaultPanel = doorTypeRow(doorType)?.default_panel;
                    updateItem(idx, {
                      doorType,
                      // a design from the previous door type can't stay selected
                      designNumber: designNumbersFor(doorType).includes(it.designNumber) ? it.designNumber : "",
                      // never replaces a panel someone already picked
                      panel: !it.panel && defaultPanel && panelOpts.includes(defaultPanel) ? defaultPanel : it.panel,
                    });
                  }}
                />
                {doorTypeOpts.length === 0 && (
                  <span className="field-hint">No door types added yet — an admin can add them under Manage lists.</span>
                )}
              </div>
              <div className="field">
                <label>Design number</label>
                <SearchSelect
                  value={it.designNumber}
                  options={designOpts}
                  placeholder="Type or pick a design number…"
                  emptyText="No design number matches"
                  onChange={(designNumber) => updateItem(idx, { designNumber })}
                />
                {it.doorType && designOpts.length === 0 && (
                  <span className="field-hint">No design numbers for this door type — attach the photo under Reference photos below.</span>
                )}
                {designNumberOpts.length === 0 && (
                  <span className="field-hint">No design numbers added yet — an admin can add them under Manage lists.</span>
                )}
                {it.designNumber && !designPhotos[it.designNumber] && (
                  <span className="field-hint">No photo saved for this design number yet.</span>
                )}
                {designPhotos[it.designNumber] && (
                  <img
                    src={designPhotos[it.designNumber]}
                    alt={`Design ${it.designNumber}`}
                    title="Click to view full screen"
                    onClick={() => open([designPhotos[it.designNumber]])}
                    style={{ alignSelf: "flex-start", maxWidth: "100%", maxHeight: 200, objectFit: "contain", marginTop: 8, borderRadius: "var(--r-md)", border: "1px solid var(--g200)", cursor: "zoom-in" }}
                  />
                )}
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
            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "var(--g600)", textTransform: "uppercase", letterSpacing: ".07em", display: "block", marginBottom: 10 }}>
                Reference photos (shown to the factory floor) {photoRequired ? <span className="req">*</span> : "— optional"}
              </label>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <label className="btn btn-sm">
                  <Camera size={13} /> Camera
                  <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { handlePhotoInput(idx, e.target.files); e.target.value = ""; }} />
                </label>
                <label className="btn btn-sm">
                  <ImagePlus size={13} /> Gallery
                  <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { handlePhotoInput(idx, e.target.files); e.target.value = ""; }} />
                </label>
              </div>
              {photoRequired && it.photos.length === 0 && <span className="field-hint">A reference photo is required for {it.doorType}.</span>}
              <div className="photo-grid">
                {it.photos.map((p, j) => (
                  <div key={j} style={{ position: "relative" }}>
                    <img src={p.previewUrl} className="photo-thumb" alt={`Photo ${j + 1}`} onClick={() => removePhoto(idx, j)} title="Click to remove" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removePhoto(idx, j)}
                      style={{ position: "absolute", top: -6, right: -6, background: "#1a1a18", color: "#fff", border: "none", borderRadius: "50%", width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <label>Notes — optional</label>
              <textarea rows={2} placeholder="Special instructions, finishing details, colour codes..." value={it.notes} onChange={(e) => updateItem(idx, { notes: e.target.value })} />
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

      <div className="btn-group">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spin" /> : <Save size={14} />}
          {saving ? "Saving..." : "Place order"}
        </button>
        <button className="btn" onClick={resetForm}>
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      {viewer}
    </div>
  );
}
