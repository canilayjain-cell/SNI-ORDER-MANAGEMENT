import type { Role } from "./types";

// Which routes each role is allowed to reach. This mirrors — but does not
// replace — the row-level-security policies in supabase/schema.sql. This
// list only controls navigation/UX; the database is the real gate.
export const ROLE_ROUTES: Record<Role, string[]> = {
  admin: ["/orders", "/floor", "/dispatch", "/worksheet", "/lists", "/users"],
  factory: ["/floor", "/dispatch"],
  sales: ["/orders", "/floor", "/worksheet"],
};

export const DEFAULT_ROUTE: Record<Role, string> = {
  admin: "/orders",
  factory: "/floor",
  sales: "/orders",
};

export function canWorkFloor(role: Role): boolean {
  return role === "factory" || role === "admin";
}

export function canExport(role: Role): boolean {
  return role === "admin";
}

export function isRoleAllowed(role: Role, path: string): boolean {
  return (ROLE_ROUTES[role] || []).some((r) => path === r || path.startsWith(r + "/"));
}
