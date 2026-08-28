"use client";
import { useMemo, useState } from "react";
import { useOrders } from "@/lib/hooks/useOrders";
import { useAuth } from "@/components/AuthProvider";
import { canExport } from "@/lib/roles";
import { average, deliveryDueInfo, durationHours, fmtDate, fmtDateTime, fmtDuration, fmtHours, orderLabel } from "@/lib/format";
import StatusBadge, { STATUS_COLOR, STATUS_LABEL } from "@/components/StatusBadge";
import PrintDoc from "@/components/PrintDoc";
import { toast } from "@/lib/toast";
import type { Order, OrderStatus } from "@/lib/types";
import { RefreshCw, Download, Printer, Table2 } from "lucide-react";

export default function WorksheetPage() {
  const { orders, reload } = useOrders();
  const { profile } = useAuth();
  const exportAllowed = profile ? canExport(profile.role) : false;

  const [fParty, setFParty] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDesign, setFDesign] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [printOrders, setPrintOrders] = useState<Order[] | null>(null);

  const parties = useMemo(() => Array.from(new Set(orders.map((o) => o.party))).sort(), [orders]);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return orders.filter(
      (o) =>
        (!fParty || o.party === fParty) &&
        (!fStatus || o.status === fStatus) &&
        (!fDesign || o.design === fDesign) &&
        (!q || o.order_no.toLowerCase().includes(q) || o.party.toLowerCase().includes(q))
    );
  }, [orders, fParty, fStatus, fDesign, fSearch]);

  const counts = useMemo(() => {
    const c: Record<OrderStatus, number> = { pending: 0, in_progress: 0, completed: 0, dispatched: 0 };
    orders.forEach((o) => { c[o.status]++; });
    return c;
  }, [orders]);

  const avgProd = useMemo(
    () => average(orders.filter((o) => o.in_progress_at && o.completed_at).map((o) => durationHours(o.in_progress_at, o.completed_at))),
    [orders]
  );
  const avgDispatch = useMemo(
    () => average(orders.filter((o) => o.dispatched_at).map((o) => durationHours(o.created_at, o.dispatched_at))),
    [orders]
  );

  const prodChart = useMemo(
    () =>
      orders
        .filter((o) => o.in_progress_at && o.completed_at)
        .slice(0, 12)
        .map((o) => ({ label: o.order_no.split("/").pop()?.trim() || o.order_no, value: durationHours(o.in_progress_at, o.completed_at) || 0 })),
    [orders]
  );
  const dispatchChart = useMemo(
    () =>
      orders
        .filter((o) => o.dispatched_at)
        .slice(0, 12)
        .map((o) => ({ label: o.order_no.split("/").pop()?.trim() || o.order_no, value: durationHours(o.created_at, o.dispatched_at) || 0 })),
    [orders]
  );

  function exportCSV() {
    if (!orders.length) { toast("No orders to export"); return; }
    const header = ["Order No", "Item", "Order Date", "Party", "Thickness", "Panel", "Length(mm)", "Breadth(mm)", "Qty",
      "Total Area(sqft)", "Design", "Delivery", "Status", "In Progress At", "Completed At", "Dispatched At",
      "Production Time", "Dispatch Lead Time", "Notes"];
    const rows = orders.map((o) => [
      o.order_no, o.line_count > 1 ? `${o.line_no}/${o.line_count}` : "",
      fmtDate(o.created_at), o.party, o.thick, o.panel, o.length_mm, o.breadth_mm, o.qty,
      o.total_sqft, o.design, fmtDate(o.delivery_date), STATUS_LABEL[o.status],
      fmtDateTime(o.in_progress_at), fmtDateTime(o.completed_at), fmtDateTime(o.dispatched_at),
      fmtDuration(o.in_progress_at, o.completed_at), fmtDuration(o.created_at, o.dispatched_at),
      `"${(o.notes || "").replace(/"/g, '""')}"`,
    ].join(","));
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `SNI_Orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast("CSV exported");
  }

  function printSingle(o: Order) {
    setPrintOrders([o]);
    setTimeout(() => window.print(), 50);
  }
  function printChecked() {
    const ids = Object.keys(checked).filter((id) => checked[id]);
    if (!ids.length) { toast("Select at least one order"); return; }
    setPrintOrders(orders.filter((o) => ids.includes(o.id)));
    setTimeout(() => window.print(), 50);
  }

  const total = orders.length;

  return (
    <div className="page-inner page-wide">
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Order worksheet</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => reload()}><RefreshCw size={13} /> Refresh</button>
          {exportAllowed && <button className="btn btn-sm" onClick={exportCSV}><Download size={13} /> Export CSV</button>}
          {exportAllowed && <button className="btn btn-sm" onClick={printChecked}><Printer size={13} /> Print selected</button>}
        </div>
      </div>

      <div className="stat-grid no-print">
        <StatTile label="Pending" value={counts.pending} color={STATUS_COLOR.pending} />
        <StatTile label="In progress" value={counts.in_progress} color={STATUS_COLOR.in_progress} />
        <StatTile label="Awaiting dispatch" value={counts.completed} color={STATUS_COLOR.completed} />
        <StatTile label="Dispatched" value={counts.dispatched} color={STATUS_COLOR.dispatched} />
        <StatTile label="Avg. production time" value={fmtHours(avgProd)} sub="In progress → Completed" />
        <StatTile label="Avg. dispatch lead time" value={fmtHours(avgDispatch)} sub="Order date → Dispatched" />
      </div>

      {exportAllowed && (
        <div className="chart-grid no-print">
          <div className="chart-card">
            <h3>Production time by order (hrs) — In progress → Completed</h3>
            <BarChart data={prodChart} color={STATUS_COLOR.in_progress} />
          </div>
          <div className="chart-card">
            <h3>Dispatch lead time by order (hrs) — Order date → Dispatched</h3>
            <BarChart data={dispatchChart} color={STATUS_COLOR.dispatched} />
          </div>
        </div>
      )}

      <div className="ws-filters no-print">
        <select value={fParty} onChange={(e) => setFParty(e.target.value)}>
          <option value="">All parties</option>
          {parties.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="dispatched">Dispatched</option>
        </select>
        <select value={fDesign} onChange={(e) => setFDesign(e.target.value)}>
          <option value="">All designs</option>
          <option value="2D">2D</option>
          <option value="3D">3D</option>
        </select>
        <input type="text" placeholder="Search order / party..." value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
      </div>

      {total === 0 ? (
        <div className="ws-wrap">
          <div className="ws-empty">
            <Table2 size={36} strokeWidth={1.5} color="var(--g400)" style={{ display: "block", margin: "0 auto 10px" }} />
            <div style={{ fontWeight: 500, marginBottom: 4 }}>No orders yet</div>
            <div style={{ fontSize: 12 }}>Create your first order from the New order tab.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="ws-summary">
            <span className="badge bb">{filtered.length} orders</span>
            <span className="badge ba">{filtered.filter((o) => o.status === "pending").length} pending</span>
            <span className="badge bt">{filtered.reduce((s, o) => s + Number(o.total_sqft || 0), 0).toFixed(2)} sqft total</span>
          </div>
          <div className="ws-wrap">
            <table className="ws-table">
              <thead>
                <tr>
                  {exportAllowed && (
                    <th style={{ width: 32 }} className="no-print">
                      <input
                        type="checkbox"
                        onChange={(e) => {
                          const next: Record<string, boolean> = {};
                          filtered.forEach((o) => (next[o.id] = e.target.checked));
                          setChecked(next);
                        }}
                      />
                    </th>
                  )}
                  <th>Order no.</th><th>Party</th><th>Panel / thick</th>
                  <th>Size &amp; area</th><th>Delivery</th><th>Design</th><th>Status</th>
                  <th>Order date</th><th>In progress</th><th>Completed</th><th>Dispatched</th>
                  <th>Production time</th><th>Dispatch lead time</th><th className="no-print"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => {
                  const due = deliveryDueInfo(o.delivery_date);
                  return (
                    <tr key={o.id}>
                      {exportAllowed && (
                        <td className="no-print">
                          <input
                            type="checkbox"
                            checked={!!checked[o.id]}
                            onChange={(e) => setChecked((prev) => ({ ...prev, [o.id]: e.target.checked }))}
                          />
                        </td>
                      )}
                      <td className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--g600)" }}>{orderLabel(o)}</td>
                      <td>{o.party}</td>
                      <td style={{ fontSize: 12 }}>{o.panel}<br /><span style={{ color: "var(--g600)" }}>{o.thick}</span></td>
                      <td style={{ fontSize: 12 }}>{o.length_mm}×{o.breadth_mm} mm<br /><span style={{ color: "var(--g600)" }}>{o.total_sqft} sqft</span></td>
                      <td style={{ fontSize: 12, ...due.css }}>{fmtDate(o.delivery_date)}<br /><span style={{ fontSize: 11, fontWeight: 400, color: "var(--g600)" }}>{due.label}</span></td>
                      <td><span className={`badge ${o.design === "3D" ? "bb" : "bt"}`}>{o.design}</span></td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtDateTime(o.created_at)}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtDateTime(o.in_progress_at)}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtDateTime(o.completed_at)}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtDateTime(o.dispatched_at)}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtDuration(o.in_progress_at, o.completed_at)}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{fmtDuration(o.created_at, o.dispatched_at)}</td>
                      <td className="no-print">
                        <button className="btn btn-sm" style={{ padding: "4px 8px" }} onClick={() => printSingle(o)}>
                          <Printer size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {printOrders && <PrintDoc orders={printOrders} />}
    </div>
  );
}

function StatTile({ label, value, color, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function BarChart({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  if (!data.length) return <div className="bar-empty">No data yet.</div>;
  const max = Math.max(...data.map((d) => d.value)) || 1;
  return (
    <div className="bar-chart">
      {data.map((d, i) => (
        <div className="bar-col" key={i} title={`${d.label}: ${d.value.toFixed(1)}h`}>
          <div className="bar-fill" style={{ height: `${Math.max(3, (d.value / max) * 100)}%`, background: color }} />
        </div>
      ))}
    </div>
  );
}
