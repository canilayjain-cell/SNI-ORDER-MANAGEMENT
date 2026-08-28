import type { CSSProperties } from "react";

// Order number for display. Items placed together share one order_no, so when
// there is more than one item we append its position, e.g. "SNI / 26-27 / 001 · item 2/3".
export function orderLabel(o: { order_no: string; line_no?: number; line_count?: number }): string {
  return o.line_count && o.line_count > 1 ? `${o.order_no} · item ${o.line_no}/${o.line_count}` : o.order_no;
}

export function fmtDate(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function durationHours(startIso?: string | null, endIso?: string | null): number | null {
  if (!startIso || !endIso) return null;
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3600000;
}

export function fmtDuration(startIso?: string | null, endIso?: string | null): string {
  if (!startIso || !endIso) return "—";
  let ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) ms = 0;
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

export function fmtHours(hours: number | null): string {
  if (hours === null) return "—";
  const mins = Math.round(hours * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

export function average(nums: (number | null)[]): number | null {
  const clean = nums.filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

export function deliveryDueInfo(deliveryStr?: string | null): { css: CSSProperties; label: string } {
  if (!deliveryStr) return { css: {}, label: "—" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dd = new Date(deliveryStr);
  const diff = Math.ceil((dd.getTime() - today.getTime()) / 86400000);
  const css: CSSProperties =
    diff <= 2 ? { color: "var(--red)", fontWeight: 600 } : diff <= 5 ? { color: "var(--amber)" } : {};
  const label = diff > 0 ? `in ${diff}d` : diff === 0 ? "today" : "overdue";
  return { css, label };
}
