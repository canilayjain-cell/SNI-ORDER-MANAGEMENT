import type { OrderStatus } from "@/lib/types";

const LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  dispatched: "Dispatched",
};
const CLASS: Record<OrderStatus, string> = {
  pending: "bn",
  in_progress: "ba",
  completed: "bg",
  dispatched: "bp",
};

export default function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge ${CLASS[status]}`}>{LABEL[status]}</span>;
}

export const STATUS_COLOR: Record<OrderStatus, string> = {
  pending: "#9A9890",
  in_progress: "#854F0B",
  completed: "#3B6D11",
  dispatched: "#3C3489",
};
export const STATUS_LABEL = LABEL;
