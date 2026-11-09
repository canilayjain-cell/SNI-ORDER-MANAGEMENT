"use client";
import { useState } from "react";
import { useOptionLists } from "@/lib/hooks/useOptionLists";
import { toast } from "@/lib/toast";
import { resizeImageToBlob } from "@/lib/image";
import { uploadToBucket } from "@/lib/storage";
import { usePhotoViewer } from "@/components/PhotoViewer";
import { Pencil, Upload } from "lucide-react";
import type { ListType, OptionRow } from "@/lib/types";

export default function ManageListsPage() {
  const { rows, addOption, setDesignPhoto, setDesignDoorType, renameOption, removeOption, reload } = useOptionLists();
  const { open, viewer } = usePhotoViewer();
  const [uploading, setUploading] = useState(false);
  const [uploadDoorType, setUploadDoorType] = useState("");
  const [inThick, setInThick] = useState("");
  const [inPanel, setInPanel] = useState("");
  const [inParty, setInParty] = useState("");
  const [inSales, setInSales] = useState("");
  const [inDoorType, setInDoorType] = useState("");
  const [inDesignNo, setInDesignNo] = useState("");

  async function handleAdd(type: ListType, value: string, clear: () => void) {
    const v = value.trim();
    if (!v) return;
    const err = await addOption(type, v);
    if (err) { toast("Could not add: " + err.message); return; }
    clear();
    toast(`"${v}" added`);
  }

  async function handleRename(row: OptionRow) {
    const value = window.prompt(`Rename "${row.value}" to:`, row.value)?.trim();
    if (!value || value === row.value) return;
    const err = await renameOption(row, value);
    if (err) { toast("Could not rename: " + err.message); return; }
    toast(`Renamed to "${value}"`);
  }

  async function handleRemove(row: OptionRow) {
    const err = await removeOption(row.id);
    if (err) { toast("Could not remove: " + err.message); return; }
    toast("Removed");
  }

  // resizes, stores under a new random name (orders keep the old file) and
  // saves it against the design number
  async function saveDesignPhoto(value: string, file: File, doorType?: string) {
    const { blob } = await resizeImageToBlob(file, 1600, 0.8);
    const url = await uploadToBucket("design-photos", `${crypto.randomUUID()}.jpg`, blob);
    const err = await setDesignPhoto(value, url, doorType);
    if (err) throw new Error(err.message);
  }

  // the file name (without its extension) is the design number
  async function handleBulkUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      const name = f.name.replace(/\.[^.]+$/, "").trim();
      const existing = designNoRows.find((r) => r.value.toLowerCase() === name.toLowerCase());
      try {
        await saveDesignPhoto(existing?.value ?? name, f, uploadDoorType);
      } catch {
        failed.push(f.name);
      }
    }
    await reload();
    setUploading(false);
    const done = files.length - failed.length;
    toast(failed.length ? `${done} saved. Could not save: ${failed.join(", ")}` : `${done} design photo${done === 1 ? "" : "s"} saved`);
  }

  async function handleDesignDoorType(row: OptionRow, doorType: string) {
    const err = await setDesignDoorType(row.id, doorType);
    if (err) toast("Could not update door type: " + err.message);
  }

  async function handleSinglePhoto(row: OptionRow, file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      await saveDesignPhoto(row.value, file);
      await reload();
      toast(`Photo saved for ${row.value}`);
    } catch (e: any) {
      toast("Could not save photo: " + e.message);
    }
    setUploading(false);
  }

  const thickRows = rows.filter((r) => r.list_type === "thick");
  const panelRows = rows.filter((r) => r.list_type === "panel");
  const partyRows = rows.filter((r) => r.list_type === "party");
  const salesRows = rows.filter((r) => r.list_type === "salesperson");
  const doorTypeRows = rows.filter((r) => r.list_type === "door_type");
  const designNoRows = rows.filter((r) => r.list_type === "design_number");

  return (
    <div className="page-inner">
      <div className="mgr-grid">
        <div className="card">
          <div className="card-head">Thickness options</div>
          <ListBlock rows={thickRows} onRemove={handleRemove} onRename={handleRename} />
          <div className="add-row">
            <input type="text" placeholder="e.g. 10mm" value={inThick} onChange={(e) => setInThick(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("thick", inThick, () => setInThick(""))}>Add</button>
          </div>
        </div>
        <div className="card">
          <div className="card-head">Panel options</div>
          <ListBlock rows={panelRows} onRemove={handleRemove} onRename={handleRename} />
          <div className="add-row">
            <input type="text" placeholder="e.g. Sunboard" value={inPanel} onChange={(e) => setInPanel(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("panel", inPanel, () => setInPanel(""))}>Add</button>
          </div>
        </div>
        <div className="card">
          <div className="card-head">Salespeople (order placed by)</div>
          <ListBlock rows={salesRows} onRemove={handleRemove} onRename={handleRename} />
          <div className="add-row">
            <input type="text" placeholder="e.g. Ramesh" value={inSales} onChange={(e) => setInSales(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("salesperson", inSales, () => setInSales(""))}>Add</button>
          </div>
        </div>
        <div className="card">
          <div className="card-head">Door types</div>
          <ListBlock rows={doorTypeRows} onRemove={handleRemove} onRename={handleRename} />
          <div className="add-row">
            <input type="text" placeholder="New door type..." value={inDoorType} onChange={(e) => setInDoorType(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("door_type", inDoorType, () => setInDoorType(""))}>Add</button>
          </div>
        </div>
        <div className="card" style={{ gridColumn: "1/-1" }}>
          <div className="card-head">Design numbers &amp; photos</div>
          <p style={{ fontSize: 12.5, color: "var(--g600)", marginBottom: 10 }}>
            Name each photo after its design number, e.g. <b>D-101.jpg</b>, and upload them together. A new number is added
            to the list; an existing number gets its photo replaced.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <select className="status-sel" value={uploadDoorType} aria-label="Door type for uploaded photos" onChange={(e) => setUploadDoorType(e.target.value)}>
            <option value="">Door type for these photos…</option>
            {doorTypeRows.map((d) => <option key={d.id} value={d.value}>{d.value}</option>)}
          </select>
          <label className="btn btn-sm">
            {uploading ? <span className="spin" /> : <Upload size={13} />}
            {uploading ? "Uploading..." : "Upload photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={uploading}
              style={{ display: "none" }}
              onChange={(e) => { handleBulkUpload(e.target.files); e.target.value = ""; }}
            />
          </label>
          </div>
          {designNoRows.length === 0 ? (
            <div className="mgr-empty">No items yet.</div>
          ) : (
            <div className="mgr-list" style={{ maxHeight: 420 }}>
              {designNoRows.map((r) => (
                <div className="mgr-item" key={r.id}>
                  {r.photo_url ? (
                    <img
                      src={r.photo_url}
                      alt={`Design ${r.value}`}
                      style={{ width: 40, height: 40, objectFit: "cover", borderRadius: "var(--r-sm)", cursor: "pointer" }}
                      onClick={() => open([r.photo_url as string])}
                    />
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--g400)" }}>No photo</span>
                  )}
                  <span style={{ flex: 1, minWidth: 0 }}>{r.value}</span>
                  <select className="status-sel" value={r.door_type || ""} aria-label={`Door type for ${r.value}`} onChange={(e) => handleDesignDoorType(r, e.target.value)}>
                    <option value="">Any door type</option>
                    {doorTypeRows.map((d) => <option key={d.id} value={d.value}>{d.value}</option>)}
                  </select>
                  <label className="btn btn-sm" style={{ padding: "4px 8px" }}>
                    {r.photo_url ? "Replace" : "Add photo"}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploading}
                      style={{ display: "none" }}
                      onChange={(e) => { handleSinglePhoto(r, e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </label>
                  <button className="mgr-del" aria-label={`Rename ${r.value}`} title="Rename" onClick={() => handleRename(r)}><Pencil size={12} /></button>
                  <button className="mgr-del" aria-label={`Remove ${r.value}`} onClick={() => handleRemove(r)}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="add-row">
            <input type="text" placeholder="New design number..." value={inDesignNo} onChange={(e) => setInDesignNo(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("design_number", inDesignNo, () => setInDesignNo(""))}>Add</button>
          </div>
        </div>
        <div className="card" style={{ gridColumn: "1/-1" }}>
          <div className="card-head">Party list</div>
          <ListBlock rows={partyRows} onRemove={handleRemove} onRename={handleRename} />
          <div className="add-row">
            <input type="text" placeholder="New party name..." value={inParty} onChange={(e) => setInParty(e.target.value)} />
            <button className="btn btn-sm btn-primary" onClick={() => handleAdd("party", inParty, () => setInParty(""))}>Add</button>
          </div>
        </div>
      </div>
      {viewer}
    </div>
  );
}

function ListBlock({ rows, onRemove, onRename }: { rows: OptionRow[]; onRemove: (r: OptionRow) => void; onRename: (r: OptionRow) => void }) {
  if (!rows.length) return <div className="mgr-empty">No items yet.</div>;
  return (
    <div className="mgr-list">
      {rows.map((r) => (
        <div className="mgr-item" key={r.id}>
          <span style={{ flex: 1, minWidth: 0 }}>{r.value}</span>
          <button className="mgr-del" aria-label={`Rename ${r.value}`} title="Rename" onClick={() => onRename(r)}><Pencil size={12} /></button>
          <button className="mgr-del" aria-label={`Remove ${r.value}`} onClick={() => onRemove(r)}>✕</button>
        </div>
      ))}
    </div>
  );
}
