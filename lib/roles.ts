import type { Role } from "./types";

// Which routes each role is allowed to reach. This mirrors — but does not
// replace — the row-level-security policies in supabase/schema.sql. This
// list only controls navigation/UX; the database is the real gate.
export const ROLE_ROUTES: Record<Role, string[]> = {
  admin: ["/orders", "/floor", "/dispatch", "/worksheet", "/lists", "/users", "/machinery", "/raw-materials"],
  factory: ["/floor", "/dispatch", "/raw-materials"],
  sales: ["/orders", "/floor", "/worksheet", "/raw-materials"],
  floor_manager: ["/floor", "/dispatch", "/machinery", "/raw-materials"],
};

export const DEFAULT_ROUTE: Record<Role, string> = {
  admin: "/orders",
  factory: "/floor",
  sales: "/orders",
  floor_manager: "/floor",
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  factory: "Factory",
  sales: "Sales",
  floor_manager: "Floor manager",
};

export function canWorkFloor(role: Role): boolean {
  return role === "factory" || role === "floor_manager" || role === "admin";
}

export function canManageMachines(role: Role): boolean {
  return role === "admin";
}

export function canExport(role: Role): boolean {
  return role === "admin";
}

export function isRoleAllowed(role: Role, path: string): boolean {
  return (ROLE_ROUTES[role] || []).some((r) => path === r || path.startsWith(r + "/"));
}
