"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusCircle, ClipboardList, Truck, Table2, Settings, Users } from "lucide-react";
import { ROLE_ROUTES } from "@/lib/roles";
import type { Role } from "@/lib/types";

const TAB_META: Record<string, { label: string; icon: React.ElementType }> = {
  "/orders": { label: "New order", icon: PlusCircle },
  "/floor": { label: "Floor queue", icon: ClipboardList },
  "/dispatch": { label: "Dispatch", icon: Truck },
  "/worksheet": { label: "Worksheet", icon: Table2 },
  "/lists": { label: "Manage lists", icon: Settings },
  "/users": { label: "Manage users", icon: Users },
};

export default function TabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const tabs = ROLE_ROUTES[role] || [];

  return (
    <div className="tab-bar no-print">
      {tabs.map((t) => {
        const meta = TAB_META[t];
        if (!meta) return null;
        const Icon = meta.icon;
        const active = pathname === t || pathname.startsWith(t + "/");
        return (
          <Link key={t} href={t} className={`tab-btn ${active ? "active" : ""}`}>
            <Icon size={14} />
            {meta.label}
          </Link>
        );
      })}
    </div>
  );
}
