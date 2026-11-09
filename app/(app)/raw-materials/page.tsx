"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "@/lib/toast";
import { fmtDate } from "@/lib/format";
import { uploadToBucket } from "@/lib/storage";
import type { RawMaterial, RawMaterialStatus } from "@/lib/types";
import { Mic, Plus, RefreshCw, Square, Trash2 } from "lucide-react";

const STATUSES: { value: RawMaterialStatus; label: string; badge: string }[] = [
  { value: "order_placed", label: "Order placed", badge: "bn" },
  { value: "in_dispatch", label: "In dispatch", badge: "ba" },
  { value: "delivered", label: "Delivered", badge: "bg" },
];
const COMPLETED = "completed";
const UNITS = ["Pcs", "Sheets", "Kg", "Ltr", "Mtr", "Sqft", "Box"];
const VOICE_BUCKET = "voice-notes";
const MAX_VOICE_SECONDS = 120;
// mp4 first: it plays on every phone; webm is the fallback for older Chrome
const VOICE_FORMATS = [
  { mime: "audio/mp4", type: "audio/mp4", ext: "m4a" },
  { mime: "audio/webm;codecs=opus", type: "audio/webm", ext: "webm" },
  { mime: "audio/webm", type: "audio/webm", ext: "webm" },
];

interface VoiceNote { blob: Blob; previewUrl: string; type: string; ext: string }

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
  const [voice, setVoice] = useState<VoiceNote | null>(null);

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
    let voiceUrl: string | null = null;
    if (voice) {
      try {
        voiceUrl = await uploadToBucket(VOICE_BUCKET, `${profile?.id}/${crypto.randomUUID()}.${voice.ext}`, voice.blob, voice.type);
      } catch (e: any) {
        setSaving(false);
        toast("Could not save voice note: " + e.message);
        return;
      }
    }
    const { error } = await supabase.from("raw_materials").insert({
      material: name,
      quantity: parseFloat(quantity),
      unit,
      needed_by: neededBy || null,
      notes: notes.trim() || null,
      requested_by_name: profile?.full_name || profile?.email || null,
      voice_note_url: voiceUrl,
    });
    setSaving(false);
    if (error) { toast("Could not add: " + error.message); return; }
    setMaterial(""); setQuantity(""); setNeededBy(""); setNotes("");
    if (voice) URL.revokeObjectURL(voice.previewUrl);
    setVoice(null);
    toast(`"${name}" added`);
    load();
  }

  async function changeStatus(row: RawMaterial, status: string) {
    // Completed rows are not kept: this table only holds open requirements
    if (status === COMPLETED) {
      if (!window.confirm(`Mark "${row.material}" as completed?\n\nThis permanently deletes it from the list.`)) return;
      const { error } = await supabase.from("raw_materials").delete().eq("id", row.id);
      if (error) { toast("Could not complete: " + error.message); return; }
      const voicePath = row.voice_note_url?.split(`/${VOICE_BUCKET}/`)[1];
      if (voicePath) await supabase.storage.from(VOICE_BUCKET).remove([decodeURIComponent(voicePath)]);
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
        <VoiceRecorder value={voice} onChange={setVoice} />
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
                  {r.voice_note_url && (
                    <audio controls preload="none" src={r.voice_note_url} style={{ display: "block", width: "100%", maxWidth: 300, height: 36, marginTop: 6 }} />
                  )}
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

function VoiceRecorder({ value, onChange }: { value: VoiceNote | null; onChange: (v: VoiceNote | null) => void }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // leaving the page mid-recording must release the microphone
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    setRecording(false);
  }

  async function start() {
    const format = typeof MediaRecorder === "undefined" ? undefined : VOICE_FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime));
    if (!navigator.mediaDevices?.getUserMedia || !format) {
      toast("Voice notes are not supported on this browser");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e: any) {
      toast(
        e.name === "NotAllowedError"
          ? "Microphone is blocked. Allow it for this site in your browser settings, then try again."
          : e.name === "NotFoundError"
            ? "No microphone found on this device"
            : "Could not start the microphone: " + e.message
      );
      return;
    }
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: format.mime });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: format.type });
      if (blob.size) onChange({ blob, previewUrl: URL.createObjectURL(blob), type: format.type, ext: format.ext });
    };
    recorderRef.current = recorder;
    recorder.start();
    setSeconds(0);
    setRecording(true);
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_VOICE_SECONDS) stop();
        return s + 1;
      });
    }, 1000);
  }

  function discard() {
    if (value) URL.revokeObjectURL(value.previewUrl);
    onChange(null);
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="field" style={{ marginBottom: 14 }}>
      <label>Voice note</label>
      {value ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <audio controls src={value.previewUrl} style={{ width: "100%", maxWidth: 300, height: 36 }} />
          <button type="button" className="btn btn-sm btn-icon" aria-label="Delete voice note" title="Delete voice note" onClick={discard}>
            <Trash2 size={13} />
          </button>
        </div>
      ) : recording ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" className="btn btn-sm btn-danger" onClick={stop}>
            <Square size={13} /> Stop
          </button>
          <span className="mono" style={{ fontSize: 12 }}>Recording {clock} / 2:00</span>
        </div>
      ) : (
        <div>
          <button type="button" className="btn btn-sm" onClick={start}>
            <Mic size={13} /> Record voice note
          </button>
        </div>
      )}
    </div>
  );
}
