function daysInMonth(year: number, month: number) {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeap(year)) return 29;
  return lengths[month - 1];
}

function isLeap(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function formatYmd(year: number, month: number, day: number) {
  const y = String(year);
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(year: number, month: number, day: number, delta: number) {
  let y = year;
  let m = month;
  let d = day + delta;
  while (d > daysInMonth(y, m)) {
    d -= daysInMonth(y, m);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  while (d < 1) {
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    d += daysInMonth(y, m);
  }
  return formatYmd(y, m, d);
}

const WEEKDAYS = /\b(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/;

export function resolveDate(transcript: string, spokenOn: string): string | null {
  const text = String(transcript).toLowerCase();
  const [yearStr, monthStr, dayStr] = spokenOn.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (/\bhari\s+ini\b/.test(text)) return spokenOn;
  if (/\bkemarin\b/.test(text)) return addDays(year, month, day, -1);
  if (/\bbesok\b/.test(text)) return addDays(year, month, day, 1);

  const tgl = text.match(/\b(?:tanggal|tgl)\s+(\d+)\b/);
  if (tgl) {
    const n = Number(tgl[1]);
    if (n < 1 || n > daysInMonth(year, month)) return null;
    return formatYmd(year, month, n);
  }

  if (WEEKDAYS.test(text)) return null;
  return null;
}

export function localTodayIso(now?: Date): string {
  const d = now ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
