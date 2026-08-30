"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OptionRow } from "@/lib/types";

// Turn raw PostgREST/Postgres errors into something an admin can act on.
function friendlyOptionError(
  error: { code?: string; message?: string },
  list_type: string
): string {
  switch (error.code) {
    case "23514": // check_violation — list_type not accepted by the DB constraint
      return `The database is not set up to store "${list_type}" items yet. Run supabase/migration-003.sql in the Supabase SQL editor, then try again.`;
    case "23505": // unique_violation
      return "That value is already in the list.";
    case "42501": // insufficient_privilege — RLS blocked the insert
      return "Your account is not allowed to change this list. You need the Admin role (set it in Manage users).";
    default:
      return error.message || "Unknown error.";
  }
}

export function useOptionLists() {
  const [rows, setRows] = useState<OptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("option_lists").select("*").order("value");
    setRows(data || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const thickOpts = rows.filter((r) => r.list_type === "thick").map((r) => r.value);
  const panelOpts = rows.filter((r) => r.list_type === "panel").map((r) => r.value);
  const partyOpts = rows.filter((r) => r.list_type === "party").map((r) => r.value);
  const salespersonOpts = rows.filter((r) => r.list_type === "salesperson").map((r) => r.value);

  async function addOption(list_type: "thick" | "panel" | "party" | "salesperson", value: string) {
    const { error } = await supabase.from("option_lists").insert({ list_type, value: value.trim() });
    if (!error) await load();
    return error ? { ...error, message: friendlyOptionError(error, list_type) } : null;
  }

  async function removeOption(id: string) {
    const { error } = await supabase.from("option_lists").delete().eq("id", id);
    if (!error) await load();
    return error;
  }

  return { rows, thickOpts, panelOpts, partyOpts, salespersonOpts, loading, addOption, removeOption, reload: load };
}
