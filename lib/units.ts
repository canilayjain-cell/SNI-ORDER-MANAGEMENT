export type Unit = "mm" | "in" | "ft";

const MM_PER: Record<Unit, number> = { mm: 1, in: 25.4, ft: 304.8 };

export const UNIT_LABEL: Record<Unit, string> = { mm: "mm", in: "in", ft: "ft" };

// Read a length input in the item's chosen unit and return it in millimetres.
export function toMm(value: string, unit: Unit): number {
  return (parseFloat(value) || 0) * MM_PER[unit];
}

// The reverse, for showing a stored length in an input.
export function fromMm(mm: number, unit: Unit): string {
  return unit === "mm" ? String(mm) : String(Number((mm / MM_PER[unit]).toFixed(3)));
}
