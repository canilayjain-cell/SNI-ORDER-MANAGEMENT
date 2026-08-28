"use client";
import { useMemo } from "react";
import { useOrders } from "@/lib/hooks/useOrders";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { resizeImageToBlob } from "@/lib/image";
import { uploadToBucket } from "@/lib/storage";
import { fmtDateTime } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import Stepper from "@/components/Stepper";
import { usePhotoViewer } from "@/components/PhotoViewer";
import type { Order } from "@/lib/types";
import { Camera, Truck, Package, RefreshCw } from "lucide-react";

export default function DispatchPage() {
  const { orders, reload } = useOrders();
  const supabase = createClient();
  const { open, viewer } = usePhotoViewer();

  const ready = useMemo(
    () =>
      orders
        .filter((o) => o.status === "completed")
        .sort((a, b) => new Date(a.completed_at || 0).getTime() - new Date(b.completed_at || 0).getTime()),
    [orders]
  );
  const recent = useMemo(
    () =>
      orders
        .filter((o) => o.status === "dispatched")
        .sort((a, b) => new Date(b.dispatched_at || 0).getTime() - new Date(a.dispatched_at || 0).getTime())
        .slice(0, 6),
    [orders]
  );

  async function handleDispatchPhoto(id: string, file: File) {
    try {
      const { blob } = await resizeImageToBlob(file, 1000, 0.7);
      const path = `${id}/${Date.now()}.jpg`;
      const url = await uploadToBucket("dispatch-photos", path, blob);
      const { error } = await supabase.rpc("set_dispatch_photo", { p_order_id: id, p_photo_url: url });
      if (error) throw error;
      reload();
    } catch (e: any) {
      toast("Could not upload dispatch photo: " + e.message);
    }
  }

  async function confirmDispatch(id: string) {
    const { error } = await supabase.rpc("confirm_dispatch", { p_order_id: id });
    if (error) { toast("Could not confirm dispatch: " + error.message); return; }
    reload();
  }

  return (
    <div className="page-inner">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Dispatch</div>
          <div style={{ fontSize: 12.5, color: "var(--g600)", marginTop: 2 }}>
            Upload proof of dispatch, then confirm to close the order out.
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => reload()}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {ready.length === 0 ? (
        <div className="empty-block">
          <Truck size={32} strokeWidth={1.5} color="var(--g400)" />
          <div className="t">Nothing waiting on dispatch</div>
          <div className="b">Orders marked Completed on the floor will show up here.</div>
        </div>
      ) : (
        <div className="ticket-list">
          {ready.map((o) => (
            <DispatchTicket key={o.id} order={o} onUpload={handleDispatchPhoto} onConfirm={confirmDispatch} onViewPhotos={open} />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="recent-dispatch">
          <h3>Recently dispatched</h3>
          <div className="recent-dispatch-grid">
            {recent.map((o) => (
              <div className="recent-chip" key={o.id}>
                {o.dispatch_photo_url && <img src={o.dispatch_photo_url} alt={`Dispatch proof for ${o.order_no}`} />}
                <div>
                  <div className="ticket-id mono">{o.order_no}</div>
                  <div style={{ fontSize: 11, color: "var(--g600)" }}>{fmtDateTime(o.dispatched_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {viewer}
    </div>
  );
}

function DispatchTicket({
  order, onUpload, onConfirm, onViewPhotos,
}: {
  order: Order;
  onUpload: (id: string, file: File) => void;
  onConfirm: (id: string) => void;
  onViewPhotos: (photos: string[] | undefined) => void;
}) {
  return (
    <div className="ticket">
      <div className="ticket-media" onClick={() => onViewPhotos(order.photos)}>
        {order.photos && order.photos.length ? (
          <img src={order.photos[0]} alt={`Reference for ${order.order_no}`} />
        ) : (
          <div className="ticket-media-empty"><Package size={22} strokeWidth={1.5} /></div>
        )}
      </div>
      <div className="ticket-body">
        <div className="ticket-top">
          <span className="ticket-id mono">{order.order_no}</span>
          <StatusBadge status={order.status} />
        </div>
        <div className="ticket-title">{order.party}</div>
        <div className="ticket-sub">{order.panel} · {order.thick} · {order.length_mm}×{order.breadth_mm} mm · Qty {order.qty}</div>
        <div className="ticket-meta">Completed {fmtDateTime(order.completed_at)}</div>
        <Stepper order={order} />
      </div>
      <div className="ticket-actions dispatch-actions">
        {order.dispatch_photo_url ? (
          <div className="dispatch-photo-preview">
            <img src={order.dispatch_photo_url} alt="Dispatch proof" />
          </div>
        ) : (
          <label className="btn btn-sm">
            <Camera size={13} /> Upload dispatch photo
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(order.id, f); }}
            />
          </label>
        )}
        <button className="btn btn-sm btn-primary" disabled={!order.dispatch_photo_url} onClick={() => onConfirm(order.id)}>
          Confirm dispatch
        </button>
      </div>
    </div>
  );
}
