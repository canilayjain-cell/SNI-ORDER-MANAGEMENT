"use client";
import { useMemo, useState } from "react";
import { useOrders } from "@/lib/hooks/useOrders";
import { useAuth } from "@/components/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";
import { fromMm } from "@/lib/units";
import { canCancelOrders, canEditOrders, canWorkFloor } from "@/lib/roles";
import { deliveryDueInfo, fmtDate, orderLabel } from "@/lib/format";
import StatusBadge from "@/components/StatusBadge";
import Stepper from "@/components/Stepper";
import { usePhotoViewer } from "@/components/PhotoViewer";
import EditOrderItem from "@/components/EditOrderItem";
import type { Order } from "@/lib/types";
import { ArrowUp, ArrowDown, Clock, CheckCircle2, Package, RefreshCw, ClipboardList, XCircle, Search, X, Pencil } from "lucide-react";

type SortBy = "queue" | "order_new" | "order_old" | "delivery_soon" | "delivery_late";

const time = (d: string | null) => new Date(d || 0).getTime();

export default function FloorQueuePage() {
  const { orders, reload } = useOrders();
  const { profile } = useAuth();
  const supabase = createClient();
  const { open, viewer } = usePhotoViewer();

  const canAct = profile ? canWorkFloor(profile.role) : false;
  const canEdit = profile ? canEditOrders(profile.role) : false;
  const canCancel = profile ? canCancelOrders(profile.role) : false;
  const [editing, setEditing] = useState<Order | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("queue");
  const [party, setParty] = useState("");
  const [partyOpen, setPartyOpen] = useState(false);

  const queue = useMemo(
    () =>
      orders
        .filter((o) => o.status === "pending" || o.status === "in_progress")
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0)),
    [orders]
  );

  const partyQuery = party.trim().toLowerCase();

  const partyMatches = useMemo(
    () => Array.from(new Set(queue.map((o) => o.party))).filter((p) => p.toLowerCase().includes(partyQuery)).sort().slice(0, 8),
    [queue, partyQuery]
  );

  // sort is stable, so the items of one order stay together in queue order
  const visible = useMemo(() => {
    const rows = queue.filter((o) => o.party.toLowerCase().includes(partyQuery));
    if (sortBy === "order_new") rows.sort((a, b) => time(b.created_at) - time(a.created_at));
    if (sortBy === "order_old") rows.sort((a, b) => time(a.created_at) - time(b.created_at));
    if (sortBy === "delivery_soon") rows.sort((a, b) => time(a.delivery_date) - time(b.delivery_date));
    if (sortBy === "delivery_late") rows.sort((a, b) => time(b.delivery_date) - time(a.delivery_date));
    return rows;
  }, [queue, partyQuery, sortBy]);

  // the arrows swap neighbours in the real queue, so they only make sense
  // when the real queue is what's on screen
  const canReorder = canAct && sortBy === "queue" && !partyQuery;

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
  async function cancelOrder(id: string, orderNo: string) {
    const reason = window.prompt(`Cancel ${orderNo}?\n\nEnter the reason for cancelling this order:`);
    if (reason === null) return; // dialog dismissed
    if (!reason.trim()) { toast("A cancellation reason is required"); return; }
    const { error } = await supabase.rpc("cancel_order", { p_order_id: id, p_reason: reason.trim() });
    if (error) { toast("Could not cancel order: " + error.message); return; }
    toast(`${orderNo} cancelled`);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select className="status-sel" value={sortBy} aria-label="Sort orders" onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="queue">Sort: Queue order</option>
            <option value="order_new">Order date: newest first</option>
            <option value="order_old">Order date: oldest first</option>
            <option value="delivery_late">Delivery date: latest first</option>
            <option value="delivery_soon">Delivery date: soonest first</option>
          </select>
          <div style={{ position: "relative" }}>
            <button className="btn btn-sm" onClick={() => setPartyOpen((v) => !v)}>
              <Search size={13} /> {party.trim() ? `Party: ${party.trim()}` : "Search party"}
            </button>
            {partyOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 29 }} onClick={() => setPartyOpen(false)} />
                <div className="card" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30, width: "min(280px, calc(100vw - 32px))", marginBottom: 0, boxShadow: "0 8px 24px rgba(0,0,0,.14)" }}>
                  <div className="field" style={{ marginBottom: 6 }}>
                    <label htmlFor="party-search">Party name</label>
                    <input
                      id="party-search"
                      type="text"
                      autoFocus
                      autoComplete="off"
                      placeholder="Type a party name..."
                      value={party}
                      onChange={(e) => setParty(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setPartyOpen(false); }}
                    />
                  </div>
                  {partyMatches.map((p) => (
                    <div key={p} className="combo-opt" onClick={() => { setParty(p); setPartyOpen(false); }}>{p}</div>
                  ))}
                  {partyMatches.length === 0 && <div className="combo-opt muted">No party in the queue matches</div>}
                </div>
              </>
            )}
          </div>
          {party.trim() && (
            <button className="btn btn-sm btn-icon" aria-label="Clear party search" title="Clear party search" onClick={() => setParty("")}>
              <X size={13} />
            </button>
          )}
          <button className="btn btn-sm" onClick={() => reload()}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {queue.length === 0 ? (
        <div className="empty-block">
          <ClipboardList size={32} strokeWidth={1.5} color="var(--g400)" />
          <div className="t">Queue is empty</div>
          <div className="b">New orders placed at New order will land here as Pending.</div>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-block">
          <Search size={32} strokeWidth={1.5} color="var(--g400)" />
          <div className="t">No orders for &ldquo;{party.trim()}&rdquo;</div>
          <div className="b">Try a different party name, or clear the search.</div>
        </div>
      ) : (
        <div className="ticket-list">
          {visible.map((o, i) => (
            <FloorTicket
              key={o.id}
              order={o}
              isFirst={i === 0}
              isLast={i === visible.length - 1}
              canAct={canAct}
              canReorder={canReorder}
              canEdit={canEdit}
              canCancel={canCancel}
              onEdit={setEditing}
              onStart={startOrder}
              onComplete={completeOrder}
              onMove={move}
              onCancel={cancelOrder}
              onViewPhotos={open}
            />
          ))}
        </div>
      )}
      {viewer}
      {editing && <EditOrderItem order={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function FloorTicket({
  order, isFirst, isLast, canAct, canReorder, canEdit, canCancel, onEdit, onStart, onComplete, onMove, onCancel, onViewPhotos,
}: {
  order: Order;
  isFirst: boolean;
  isLast: boolean;
  canAct: boolean;
  canReorder: boolean;
  canEdit: boolean;
  canCancel: boolean;
  onEdit: (order: Order) => void;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onCancel: (id: string, orderNo: string) => void;
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
        {(order.placed_by || order.assigned_to_name) && (
          <div className="ticket-meta">
            {[order.placed_by && `Placed by ${order.placed_by}`, order.assigned_to_name && `Given to ${order.assigned_to_name}`].filter(Boolean).join(" · ")}
          </div>
        )}
        <div className="ticket-sub">
          {order.panel} · {order.thick}{order.door_type && ` · ${order.door_type}`}{order.design_number && ` · Design no. ${order.design_number}`} · {fromMm(order.length_mm, "in")}×{fromMm(order.breadth_mm, "in")} in · Qty {order.qty}{" "}
          <span className={`badge ${order.design === "3D" ? "bb" : "bt"}`} style={{ marginLeft: 2 }}>{order.design}</span>
        </div>
        <div className="ticket-meta">
          Placed {fmtDate(order.created_at)} · Delivery <span style={due.css}>{fmtDate(order.delivery_date)} ({due.label})</span>
        </div>
        {order.notes && <div className="ticket-notes">&quot;{order.notes}&quot;</div>}
        <Stepper order={order} />
      </div>
      <div className="ticket-actions">
        {canReorder && (
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
        {canEdit && (
          <button className="btn btn-sm" onClick={() => onEdit(order)}>
            <Pencil size={13} /> Edit
          </button>
        )}
        {canCancel && (
          <button className="btn btn-sm btn-danger" onClick={() => onCancel(order.id, order.order_no)}>
            <XCircle size={13} /> Cancel order
          </button>
        )}
        {!canAct && <span className="view-only-note">View only</span>}
      </div>
    </div>
  );
}
