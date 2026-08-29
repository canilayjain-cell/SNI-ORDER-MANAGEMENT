import type { Order } from "@/lib/types";
import { fmtDate, orderLabel } from "@/lib/format";
import { STATUS_LABEL } from "@/components/StatusBadge";

export default function PrintDoc({ orders }: { orders: Order[] }) {
  return (
    <div className="print-doc">
      {orders.map((o) => (
        <div key={o.id} style={{ pageBreakAfter: "always", padding: "24px 30px", maxWidth: 800 }}>
          <div style={{ borderBottom: "3px solid #185FA5", paddingBottom: 14, marginBottom: 18, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#185FA5" }}>SNI Sales Order</div>
              <div style={{ fontSize: 13, color: "#5F5E5A", marginTop: 3 }}>{orderLabel(o)} · {fmtDate(o.created_at)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: "#5F5E5A" }}>Status</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{STATUS_LABEL[o.status]}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
            {[
              ["Party", o.party], ["Placed by", o.placed_by], ["Design", o.design], ["Thickness", o.thick], ["Panel", o.panel],
              ["Size", `${o.length_mm}×${o.breadth_mm} mm`], ["Qty", String(o.qty)], ["Total area", `${o.total_sqft} sqft`],
              ["Delivery", fmtDate(o.delivery_date)], ["Reminder", fmtDate(o.reminder_date)], ["Order date", fmtDate(o.created_at)],
            ].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 11, color: "#5F5E5A", textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{v || "—"}</div>
              </div>
            ))}
          </div>
          {o.notes && (
            <div style={{ background: "#F8F8F6", borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#5F5E5A", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Notes</div>
              <div style={{ fontSize: 13 }}>{o.notes}</div>
            </div>
          )}
          <div style={{ marginTop: 28, borderTop: "1px solid #e0ddd5", paddingTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
            {["Prepared by", "Approved by", "Customer"].map((l) => (
              <div key={l} style={{ fontSize: 11, color: "#5F5E5A" }}>
                {l}
                <div style={{ marginTop: 36, borderTop: "1px solid #9A9890", paddingTop: 4 }}>Signature</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
