"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

// "md01", "MD 01" and "MD - 01" should all find the same option
const normSearch = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

// A dropdown you can also type in: clicking shows every option, typing narrows
// them. Only a real option counts as selected.
export default function SearchSelect({
  value, options, placeholder, emptyText, onChange,
}: {
  value: string;
  options: string[];
  placeholder: string;
  emptyText: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null); // null until the user types

  const query = normSearch(text ?? "");
  const matches = (text === null ? options : options.filter((o) => normSearch(o).includes(query))).slice(0, 50);

  function pick(option: string) {
    onChange(option);
    setText(null);
    setOpen(false);
  }

  return (
    <div className="combo">
      <input
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        style={{ paddingRight: 30 }}
        value={open && text !== null ? text : value}
        onFocus={(e) => { e.target.select(); setText(null); setOpen(true); }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          onChange(options.find((o) => normSearch(o) === normSearch(e.target.value)) ?? "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) { pick(matches[0]); e.currentTarget.blur(); }
        }}
        onBlur={() => setTimeout(() => { setOpen(false); setText(null); }, 150)}
      />
      <ChevronDown size={14} color="var(--g600)" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
      {open && (
        <div className="combo-list">
          {matches.map((o) => (
            <div key={o} className="combo-opt" onMouseDown={() => pick(o)}>{o}</div>
          ))}
          {matches.length === 0 && <div className="combo-opt muted">{emptyText}</div>}
        </div>
      )}
    </div>
  );
}
