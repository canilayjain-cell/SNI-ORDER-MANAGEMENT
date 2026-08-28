"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Order } from "@/lib/types";

export function useOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_photos(url)")
      .order("created_at", { ascending: false });
    if (!error && data) {
      setOrders(
        data.map((o: any) => ({
          ...o,
          photos: (o.order_photos || []).map((p: any) => p.url),
        }))
      );
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    if (!channelRef.current) {
      channelRef.current = supabase
        .channel("orders-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
        .on("postgres_changes", { event: "*", schema: "public", table: "order_photos" }, () => load())
        .subscribe();
    }
    const poll = setInterval(load, 30000);
    return () => {
      clearInterval(poll);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { orders, loading, reload: load };
}
