"use client";
import { useMemo } from "react";
import { useOrders } from "@/lib/hooks/useOrders";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { canWorkFloor } from "@/lib/roles";
import { deliveryDueInfo, fmtDate, orderLabel } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import Stepper from "@/components/Stepper";
import { usePhotoViewer } from "@/components/PhotoViewer";
import type { Order } from "@/lib/types";
import { ArrowUp, ArrowDown, Clock, CheckCircle2, Package, RefreshCw, ClipboardList } from "lucide-react";

export default function FloorQueuePage() {
  const { orders, reload } = useOrders();
  const { profile } = useAuth();
  const supabase = createClient();
  const { open, viewer } = usePhotoViewer();

  const canAct = profile ? canWorkFloor(profile.role) : false;

  const queue = useMemo(
    () =>
      orders
        .filter((o) => o.status === "pending" || o.status === "in_progress")
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0)),
    [orders]
  );

  async function startOrder(id: string) {
    const { error } = await supabase.rpc("start_order", { p_order_id: id });
    if (error) { toast("Could not start order: " + error.message); return; }
    reload();
  }
  async function completeOrder(id: string) {
    const { error } = await supabase.rpc("complete_order", { p_order_id: id });
    if (error) { toast("Could not complete order: " + error.message); return; }
    reload();
  }
  async function move(id: string, dir: "up" | "down") {
    const { error } = await supabase.rpc("resequence_order", { p_order_id: id, p_direction: dir });
    if (error) { toast("Could not reorder: " + error.message); return; }
    reload();
  }

  return (
    <div className="page-inner">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Floor queue</div>
          <div style={{ fontSize: 12.5, color: "var(--g600)", marginTop: 2 }}>
            {canAct ? "Ordered by fulfilment sequence — use the arrows to re-arrange." : "View only — your account can see the queue but not change it."}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => reload()}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {queue.length === 0 ? (
        <div className="empty-block">
          <ClipboardList size={32} strokeWidth={1.5} color="var(--g400)" />
          <div className="t">Queue is empty</div>
          <div className="b">New orders placed at New order will land here as Pending.</div>
        </div>
      ) : (
        <div className="ticket-list">
          {queue.map((o, i) => (
            <FloorTicket
              key={o.id}
              order={o}
              isFirst={i === 0}
              isLast={i === queue.length - 1}
              canAct={canAct}
              onStart={startOrder}
              onComplete={completeOrder}
              onMove={move}
              onViewPhotos={open}
            />
          ))}
        </div>
      )}
      {viewer}
    </div>
  );
}

function FloorTicket({
  order, isFirst, isLast, canAct, onStart, onComplete, onMove, onViewPhotos,
}: {
  order: Order;
  isFirst: boolean;
  isLast: boolean;
  canAct: boolean;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onViewPhotos: (photos: string[] | undefined) => void;
}) {
  const due = deliveryDueInfo(order.delivery_date);
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
          <span className="ticket-id mono">{orderLabel(order)}</span>
          <StatusBadge status={order.status} />
        </div>
        <div className="ticket-title">{order.party}</div>
        <div className="ticket-sub">
          {order.panel} · {order.thick} · {order.length_mm}×{order.breadth_mm} mm · Qty {order.qty}{" "}
          <span className={`badge ${order.design === "3D" ? "bb" : "bt"}`} style={{ marginLeft: 2 }}>{order.design}</span>
        </div>
        <div className="ticket-meta">
          Placed {fmtDate(order.created_at)} · Delivery <span style={due.css}>{fmtDate(order.delivery_date)} ({due.label})</span>
        </div>
        {order.notes && <div className="ticket-notes">&quot;{order.notes}&quot;</div>}
        <Stepper order={order} />
      </div>
      <div className="ticket-actions">
        {canAct && (
          <div className="reorder-buttons">
            <button className="btn btn-icon" disabled={isFirst} onClick={() => onMove(order.id, "up")} aria-label="Move up">
              <ArrowUp size={14} />
            </button>
            <button className="btn btn-icon" disabled={isLast} onClick={() => onMove(order.id, "down")} aria-label="Move down">
              <ArrowDown size={14} />
            </button>
          </div>
        )}
        {canAct && order.status === "pending" && (
          <button className="btn btn-sm btn-teal" onClick={() => onStart(order.id)}>
            <Clock size={13} /> Start
          </button>
        )}
        {canAct && order.status === "in_progress" && (
          <button className="btn btn-sm btn-primary" onClick={() => onComplete(order.id)}>
            <CheckCircle2 size={13} /> Mark completed
          </button>
        )}
        {!canAct && <span className="view-only-note">View only</span>}
      </div>
    </div>
  );
}
