/** Display amounts in Indonesian locale (IDR uses Rp, no decimal for whole rupiah). */
export function formatMoney(amount: number | null, currency: string | null | undefined): string {
  if (amount === null || !Number.isFinite(amount)) return "—";
  const code = (currency?.trim() || "IDR").toUpperCase();
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: code,
      maximumFractionDigits: code === "IDR" ? 0 : 2,
      minimumFractionDigits: code === "IDR" ? 0 : undefined,
    }).format(amount);
  } catch {
    return `${amount} ${code}`;
  }
}

export function sumIdrExpenses(
  rows: { amount: number | null; currency: string | null }[],
): number {
  let total = 0;
  for (const row of rows) {
    if (row.amount === null || !Number.isInteger(row.amount)) continue;
    const cur = (row.currency?.trim() || "IDR").toUpperCase();
    if (cur === "IDR") total += row.amount;
  }
  return total;
}
