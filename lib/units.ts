export type Unit = "mm" | "in" | "ft";

const MM_PER: Record<Unit, number> = { mm: 1, in: 25.4, ft: 304.8 };

export const UNIT_LABEL: Record<Unit, string> = { mm: "mm", in: "in", ft: "ft" };

// Read a length input in the item's chosen unit and return it in millimetres.
export function toMm(value: string, unit: Unit): number {
  return (parseFloat(value) || 0) * MM_PER[unit];
}

// The reverse, for showing a stored length in an input.
export function fromMm(mm: number, unit: Unit): string {
  return String(Number((mm / MM_PER[unit]).toFixed(3)));
}

export const isCustomThickness = (value: string) => /custom/i.test(value);

// Asks for a thickness in mm and returns it in the list's format ("22 MM"),
// or null if the box was dismissed or the entry isn't a positive number.
export function askCustomThickness(): string | null {
  const input = window.prompt("Enter the custom thickness in MM (numbers only):");
  if (input === null) return null;
  const mm = Number(input.trim());
  if (!input.trim() || !(mm > 0)) {
    alert("Please enter a valid number, for example 22.");
    return null;
  }
  return `${mm} MM`;
}
