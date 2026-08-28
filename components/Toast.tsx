"use client";
import { useEffect, useRef, useState } from "react";
import { _setToastListener } from "@/lib/toast";

export default function Toast() {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    _setToastListener((m) => {
      setMsg(m);
      setShow(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setShow(false), 2800);
    });
    return () => _setToastListener(null);
  }, []);

  return (
    <div id="toast" className={show ? "show" : ""}>
      {msg}
    </div>
  );
}
