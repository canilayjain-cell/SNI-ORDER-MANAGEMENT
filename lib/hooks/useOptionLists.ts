"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OptionRow } from "@/lib/types";

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
    const { error } = await supabase.from("option_lists").insert({ list_type, value });
    if (!error) await load();
    return error;
  }

  async function removeOption(id: string) {
    const { error } = await supabase.from("option_lists").delete().eq("id", id);
    if (!error) await load();
    return error;
  }

  return { rows, thickOpts, panelOpts, partyOpts, salespersonOpts, loading, addOption, removeOption, reload: load };
}
