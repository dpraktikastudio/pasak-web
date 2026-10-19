import { normalizeAmount, stripDateTime } from "./amount";

// Multi-item phrases, merchant-only lines, and bills may return null; user can correct in UI.

const LEADING_VERBS =
  /^(?:makan|beli|bayar|pesan|jajan|isi|naik|top\s+up|belanja|ganti|servis|tambal|pesan)\b\s*/i;

const MONEY_TOKENS =
  /\b(?:rupiah|idr|rp|ribu|ribuan|juta|jt|rb|rbu|k)\b|\d+(?:[.,]\d+)*k?\b|[\$€]/gi;

const EDGE_FILLERS = /^(?:di|ke|dari|untuk|sama|dan)\s+|\s+(?:di|ke|dari|untuk|sama|dan)$/gi;

const STOPWORDS = new Set([
  "di",
  "ke",
  "dari",
  "untuk",
  "sama",
  "dan",
  "satu",
  "dua",
  "tiga",
  "liter",
  "kilo",
  "porsi",
  "orang",
  "gelas",
  "pcs",
  "butir",
]);

function collapseSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripMoneyPhrases(text: string): string {
  let out = text.replace(MONEY_TOKENS, " ");
  out = out.replace(/\b(?:se|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|setengah)\s+(?:ribu|juta|rb|jt)\b/gi, " ");
  return collapseSpace(out);
}

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ");
}

export function extractItem(transcript: string): string | null {
  if (!transcript.trim()) return null;
  const money = normalizeAmount(transcript);
  if (money.amount === null) return null;

  let text = stripDateTime(transcript);
  text = stripMoneyPhrases(text);
  text = collapseSpace(text);

  let prev = "";
  while (text !== prev) {
    prev = text;
    text = collapseSpace(text.replace(LEADING_VERBS, ""));
    text = collapseSpace(text.replace(EDGE_FILLERS, ""));
  }

  if (!text) return null;
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0 || tokens.length > 6) return null;
  if (tokens.every((t) => STOPWORDS.has(t))) return null;

  const phrase = tokens.join(" ");
  if (phrase.length > 80) return null;
  return titleCaseWords(phrase);
}
