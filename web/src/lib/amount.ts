export type AmountResult = { amount: number | null; currency: string | null };

const NULL_RESULT: AmountResult = { amount: null, currency: null };

const UNIT_WORDS: [string, number][] = [
  ["sembilan", 9],
  ["delapan", 8],
  ["tujuh", 7],
  ["empat", 4],
  ["kosong", 0],
  ["satu", 1],
  ["tiga", 3],
  ["lima", 5],
  ["enam", 6],
  ["dua", 2],
  ["nol", 0],
];

const SCALES: [string, number][] = [
  ["ribuan", 1000],
  ["ribu", 1000],
  ["juta", 1_000_000],
  ["rb", 1000],
  ["jt", 1_000_000],
];

const HALF_SCALES: [string, number][] = [
  ["juta", 1_000_000],
  ["ribu", 1000],
  ["jt", 1_000_000],
  ["rb", 1000],
];

const QTY_WORDS = ["gelas", "pcs", "butir", "porsi", "orang"];

const CURRENCY_WORDS: [string, string][] = [
  ["rupiah", "IDR"],
  ["dollar", "USD"],
  ["usd", "USD"],
  ["idr", "IDR"],
  ["rp", "IDR"],
];

function skipSpace(s: string, i: number) {
  while (i < s.length && /\s/.test(s[i])) i += 1;
  return i;
}

function matchWord(s: string, i: number, word: string) {
  if (!s.startsWith(word, i)) return -1;
  const end = i + word.length;
  if (end < s.length && /[a-z]/.test(s[end])) return -1;
  return end;
}

function matchSe(s: string, i: number) {
  if (!s.startsWith("se", i)) return -1;
  const rest = s.slice(i + 2).replace(/^\s+/, "");
  if (/^(puluh|ratus|ribu|juta)\b/.test(rest)) return i + 2;
  return -1;
}

function matchUnit(s: string, i: number) {
  const j = skipSpace(s, i);
  for (const [word, value] of UNIT_WORDS) {
    const end = matchWord(s, j, word);
    if (end !== -1) return { value, end };
  }
  return null;
}

function matchUnitOrSe(s: string, i: number) {
  const unit = matchUnit(s, i);
  if (unit) return { ...unit, kind: "unit" };
  const j = skipSpace(s, i);
  const se = matchSe(s, j);
  if (se !== -1) return { value: 1, end: se, kind: "se" };
  return null;
}

function matchScaleFrom(s: string, i: number, table: [string, number][]) {
  const j = skipSpace(s, i);
  for (const [word, mult] of table) {
    const end = matchWord(s, j, word);
    if (end !== -1) return { mult, end };
  }
  return null;
}

function matchScale(s: string, i: number) {
  return matchScaleFrom(s, i, SCALES);
}

function matchHalfScale(s: string, i: number) {
  return matchScaleFrom(s, i, HALF_SCALES);
}

function matchQty(s: string, i: number) {
  const j = skipSpace(s, i);
  for (const word of QTY_WORDS) {
    if (matchWord(s, j, word) !== -1) return true;
  }
  return false;
}

function matchCurrency(s: string, i: number) {
  const j = skipSpace(s, i);
  if (s[j] === "$") return { currency: "USD", end: j + 1 };
  for (const [word, currency] of CURRENCY_WORDS) {
    const end = matchWord(s, j, word);
    if (end !== -1) return { currency, end };
  }
  return null;
}

function parse999(s: string, i: number) {
  let pos = i;
  let n = 0;
  let ok = false;

  const hun = matchUnitOrSe(s, pos);
  if (hun) {
    const ratus = matchWord(s, skipSpace(s, hun.end), "ratus");
    if (ratus !== -1) {
      n += hun.value * 100;
      pos = ratus;
      ok = true;
    }
  }

  const p = skipSpace(s, pos);
  const sebelas = matchWord(s, p, "sebelas");
  if (sebelas !== -1) {
    n += 11;
    pos = sebelas;
    ok = true;
  } else {
    const sepuluh = matchWord(s, p, "sepuluh");
    if (sepuluh !== -1) {
      n += 10;
      pos = sepuluh;
      ok = true;
    } else {
      const ten = matchUnitOrSe(s, p);
      if (ten) {
        const after = skipSpace(s, ten.end);
        const puluh = matchWord(s, after, "puluh");
        if (puluh !== -1) {
          n += ten.value * 10;
          pos = puluh;
          ok = true;
        } else if (ten.value >= 2 && ten.kind !== "se") {
          const belas = matchWord(s, after, "belas");
          if (belas !== -1) {
            n += ten.value + 10;
            pos = belas;
            ok = true;
          }
        }
      }
    }
  }

  const unit = matchUnit(s, pos);
  if (unit) {
    n += unit.value;
    pos = unit.end;
    ok = true;
  }

  if (!ok) return null;
  return { value: n, end: pos };
}

function parseDigit(s: string, i: number) {
  const rest = s.slice(i);
  const gluedK = rest.match(/^(\d+)k(?![a-z])/);
  if (gluedK) {
    return {
      mantissa: Number(gluedK[1]),
      fracDigits: 0,
      end: i + gluedK[0].length,
      hadK: true,
      kind: "int",
    };
  }
  const thou = rest.match(/^(\d{1,3}(?:[.,]\d{3})+)/);
  if (thou) {
    return {
      mantissa: Number(thou[1].replace(/[.,]/g, "")),
      fracDigits: 0,
      end: i + thou[0].length,
      hadK: false,
      kind: "int",
    };
  }
  const dec = rest.match(/^(\d+)[.,](\d{1,2})(?!\d)/);
  if (dec) {
    return {
      mantissa: Number(dec[1] + dec[2]),
      fracDigits: dec[2].length,
      end: i + dec[0].length,
      hadK: false,
      kind: "dec",
    };
  }
  const int = rest.match(/^\d+/);
  if (int) {
    return {
      mantissa: Number(int[0]),
      fracDigits: 0,
      end: i + int[0].length,
      hadK: false,
      kind: "int",
    };
  }
  return null;
}

function scaledInt(mantissa: number, fracDigits: number, scale: number) {
  const den = 10 ** fracDigits;
  const num = mantissa * scale;
  if (num % den !== 0) return null;
  return num / den;
}

function parseCandidate(s: string, i: number) {
  let pos = i;
  let marked = null;

  const prefix = matchCurrency(s, pos);
  if (prefix) {
    marked = prefix.currency;
    pos = skipSpace(s, prefix.end);
  }

  const sejutaan = matchWord(s, pos, "sejutaan");
  if (sejutaan !== -1) {
    return finishCandidate(1_000_000, sejutaan, marked, s);
  }

  const setengah = matchWord(s, pos, "setengah");
  if (setengah !== -1) {
    const scale = matchHalfScale(s, setengah);
    if (scale) {
      return finishCandidate(scale.mult / 2, scale.end, marked, s);
    }
  }

  const words = parse999(s, pos);
  if (words) {
    if (matchQty(s, words.end)) return null;
    const scale = matchScale(s, words.end);
    const amount = words.value * (scale ? scale.mult : 1);
    const end = scale ? scale.end : words.end;
    if (!scale && !marked && amount < 1000) return null;
    return finishCandidate(amount, end, marked, s);
  }

  const se = matchSe(s, pos);
  if (se !== -1) {
    const scale = matchScale(s, se);
    if (scale) {
      return finishCandidate(scale.mult, scale.end, marked, s);
    }
  }

  const digit = parseDigit(s, pos);
  if (!digit) return null;
  if (!digit.hadK && matchQty(s, digit.end)) return null;

  let scaleMult = digit.hadK ? 1000 : 1;
  let end = digit.end;
  if (!digit.hadK) {
    const scale = matchScale(s, digit.end);
    if (scale) {
      scaleMult = scale.mult;
      end = scale.end;
    }
  }
  const hadScale = digit.hadK || scaleMult !== 1;
  if (digit.kind === "dec" && !hadScale) return null;
  const amount = scaledInt(digit.mantissa, digit.fracDigits, scaleMult);
  if (amount === null) return null;
  if (!hadScale && !marked && amount < 1000) return null;
  return finishCandidate(amount, end, marked, s);
}

function finishCandidate(amount: number, end: number, marked: string | null, s: string) {
  const suffix = matchCurrency(s, end);
  let currencyMark = marked;
  let finalEnd = end;
  if (suffix) {
    currencyMark = currencyMark === "USD" ? "USD" : suffix.currency;
    if (marked === "USD" || suffix.currency === "USD") currencyMark = "USD";
    finalEnd = suffix.end;
  }
  if (!Number.isInteger(amount)) return null;
  const usd = currencyMark === "USD";
  return { amount, end: finalEnd, usd };
}

function skipAtom(s: string, i: number) {
  const j = skipSpace(s, i);
  if (j >= s.length) return s.length;
  if (/[a-z]/.test(s[j])) {
    let k = j;
    while (k < s.length && /[a-z]/.test(s[k])) k += 1;
    return k;
  }
  if (/\d/.test(s[j])) {
    let k = j;
    while (k < s.length && /[\d.,k]/.test(s[k])) k += 1;
    return k;
  }
  return j + 1;
}

function stripDateTime(transcript: string) {
  return String(transcript)
    .toLowerCase()
    .replace(/\btanggal\s+\d+\b/g, " ")
    .replace(/\btgl\s+\d+\b/g, " ")
    .replace(/\bjam\s+\d+\b/g, " ")
    .replace(/\bhari\s+ini\b/g, " ")
    .replace(/\bkemarin\b/g, " ")
    .replace(/\bbesok\b/g, " ");
}

export function normalizeAmount(transcript: string): AmountResult {
  const text = stripDateTime(transcript);
  if (text.includes("miliar") || text.includes("milyar")) return { ...NULL_RESULT };

  const candidates = [];
  let i = 0;
  while (i < text.length) {
    i = skipSpace(text, i);
    if (i >= text.length) break;
    const candidate = parseCandidate(text, i);
    if (candidate) {
      candidates.push(candidate);
      i = candidate.end;
    } else {
      i = skipAtom(text, i);
    }
  }

  if (candidates.length !== 1) return { ...NULL_RESULT };
  const [one] = candidates;
  if (!Number.isInteger(one.amount)) return { ...NULL_RESULT };
  return { amount: one.amount, currency: one.usd ? "USD" : "IDR" };
}
