export function formatMoney(value: number) {
  return new Intl.NumberFormat("de-CH", {
    style: "currency",
    currency: "CHF",
  }).format(value / 100);
}

export function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

export function parseMoneyToCents(value: string) {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Preis muss eine positive Zahl sein.");
  }

  return Math.round(parsed * 100);
}

export function formatCentsForInput(value: number) {
  return (value / 100).toFixed(2);
}
