import { Fragment } from "react";
import type { Order, OrderStatus } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { STATUS_COLOR, STATUS_LABEL } from "@/components/StatusBadge";

const SEQ: OrderStatus[] = ["pending", "in_progress", "completed", "dispatched"];
const SHORT: Record<OrderStatus, string> = { pending: "PEND", in_progress: "PROG", completed: "DONE", dispatched: "DISP", cancelled: "CXL" };

export default function Stepper({ order }: { order: Order }) {
  const idx = SEQ.indexOf(order.status);
  const ts: Record<OrderStatus, string | null> = {
    pending: order.created_at,
    in_progress: order.in_progress_at,
    completed: order.completed_at,
    dispatched: order.dispatched_at,
    cancelled: order.cancelled_at,
  };
  return (
    <div className="stepper">
      {SEQ.map((s, i) => {
        const reached = i <= idx;
        const color = STATUS_COLOR[s];
        return (
          <Fragment key={s}>
            {i > 0 && <div className="stepper-line" style={reached ? { background: color } : undefined} />}
            <div className="stepper-node-wrap" title={`${STATUS_LABEL[s]}: ${fmtDateTime(ts[s])}`}>
              <div
                className={`stepper-node ${reached ? "on" : ""}`}
                style={reached ? { borderColor: color, background: color } : undefined}
              >
                {reached && <span className="stepper-check">✓</span>}
              </div>
              <span className="stepper-label">{SHORT[s]}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
