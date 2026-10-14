import { useEffect, useRef, useState, type PointerEvent } from "react";
import { startPushToTalk } from "./lib/audio";
import { listExpenses, putExpense, saveCorrection } from "./lib/db";
import { localTodayIso } from "./lib/dates";
import { interpreterVersionLabel, sttVersionLabel } from "./lib/modelChoice";
import type { Category, ExpenseFields, ExpenseRecord } from "./lib/types";

const CATEGORIES: Category[] = ["food", "transport", "bills", "shopping", "health", "other"];

function fieldsEqual(a: ExpenseFields, b: ExpenseFields): boolean {
  return (
    a.amount === b.amount &&
    a.currency === b.currency &&
    a.category === b.category &&
    a.merchant === b.merchant &&
    a.date === b.date
  );
}

function displayDate(stored: string | null, today: string): { value: string; unconfirmed: boolean } {
  if (stored) return { value: stored, unconfirmed: false };
  return { value: today, unconfirmed: true };
}

export function App() {
  const [rows, setRows] = useState<ExpenseRecord[]>([]);
  const [status, setStatus] = useState("");
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [form, setForm] = useState<ExpenseFields>({
    amount: null,
    currency: null,
    category: null,
    merchant: null,
    date: null,
  });
  const [prediction, setPrediction] = useState<ExpenseFields | null>(null);
  const [dateTouched, setDateTouched] = useState(false);
  const session = useRef<ReturnType<typeof startPushToTalk> | null>(null);
  const today = localTodayIso();

  async function reload() {
    setRows(await listExpenses());
  }

  useEffect(() => {
    void reload();
  }, []);

  const amountOk = form.amount !== null && Number.isInteger(form.amount) && form.amount >= 0;
  const currencyOk = Boolean(form.currency && form.currency.trim());
  const canSave = amountOk && currencyOk && !saving && prediction !== null;

  function amountError(): string | null {
    if (prediction === null) return null;
    if (!amountOk) return "Amount must be a whole number 0 or greater.";
    if (!currencyOk) return "Currency is required.";
    return null;
  }

  async function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (holding) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStatus("");
    setHolding(true);
    setProgress({ loaded: 0 });
    session.current = startPushToTalk({
      onProgress: (loaded, total) => setProgress({ loaded, total }),
    });
  }

  async function onPointerUp() {
    const s = session.current;
    session.current = null;
    setHolding(false);
    if (!s) return;
    const result = await s.stop();
    setProgress(null);
    if (!result.ok) {
      setStatus(result.message);
      return;
    }
    const id = crypto.randomUUID();
    setDraftId(id);
    setSaved(false);
    setOpenId(null);
    setTranscript(result.transcript);
    setPrediction(result.prediction);
    setForm({ ...result.prediction });
    setDateTouched(false);
  }

  function formForSave(): ExpenseFields {
    const date = dateTouched ? form.date : prediction!.date;
    return {
      amount: form.amount,
      currency: form.currency,
      category: form.category,
      merchant: form.merchant === "" ? null : form.merchant,
      date,
    };
  }

  async function onSave() {
    if (!canSave || !prediction || !draftId) return;
    const next = formForSave();
    const correction = fieldsEqual(next, prediction) ? null : next;
    setSaving(true);
    try {
      if (!saved) {
        const record: ExpenseRecord = {
          id: draftId,
          createdAt: new Date().toISOString(),
          transcript,
          prediction,
          correction,
          modelVersions: { stt: sttVersionLabel, interpreter: interpreterVersionLabel },
        };
        await putExpense(record);
        setSaved(true);
      } else {
        await saveCorrection(draftId, correction);
      }
      await reload();
    } finally {
      setSaving(false);
    }
  }

  const dateUi = displayDate(dateTouched ? form.date : prediction?.date ?? null, today);
  const err = amountError();

  return (
    <main>
      <h1>pasak-web</h1>
      <p>
        Hold to talk. Release to transcribe. Models stay on this device (
        <code>{sttVersionLabel}</code>
        {interpreterVersionLabel ? `, ${interpreterVersionLabel}` : ", rules-only"}).
      </p>
      <button
        type="button"
        onPointerDown={(e) => void onPointerDown(e)}
        onPointerUp={() => void onPointerUp()}
        onPointerCancel={() => void onPointerUp()}
      >
        {holding ? "Recording…" : "Hold to record"}
      </button>
      {progress ? (
        <p>
          <progress value={progress.total ? progress.loaded : undefined} max={progress.total} />{" "}
          {progress.loaded}
          {progress.total ? ` / ${progress.total}` : " bytes"}
        </p>
      ) : null}
      {status ? <p role="status">{status}</p> : null}

      {prediction ? (
        <section>
          <h2>Current</h2>
          <label>
            Transcript
            <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} />
          </label>
          <label>
            Amount
            <input
              inputMode="numeric"
              value={form.amount ?? ""}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "");
                setForm({ ...form, amount: v === "" ? null : Number(v) });
              }}
            />
          </label>
          <label>
            Currency
            <input
              value={form.currency ?? ""}
              onChange={(e) => setForm({ ...form, currency: e.target.value || null })}
            />
          </label>
          {err ? <p role="alert">{err}</p> : null}
          <label>
            Category
            <select
              value={form.category ?? ""}
              onChange={(e) =>
                setForm({ ...form, category: (e.target.value || null) as Category | null })
              }
            >
              <option value="">(none)</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Merchant
            <input
              value={form.merchant ?? ""}
              onChange={(e) => setForm({ ...form, merchant: e.target.value || null })}
            />
          </label>
          <label>
            Date {dateUi.unconfirmed ? "(today, unconfirmed — not saved until you change it)" : ""}
            <input
              type="date"
              value={dateUi.value}
              onChange={(e) => {
                setDateTouched(true);
                setForm({ ...form, date: e.target.value || null });
              }}
            />
          </label>
          <button type="button" disabled={!canSave} onClick={() => void onSave()}>
            Save
          </button>
        </section>
      ) : null}

      <section>
        <h2>Past</h2>
        <ul>
          {rows.map((row) => {
            const shown = row.correction ?? row.prediction;
            const d = displayDate(shown.date, today);
            return (
              <li key={row.id}>
                <button type="button" onClick={() => setOpenId(row.id === openId ? null : row.id)}>
                  {shown.amount ?? "—"} {shown.currency ?? ""} {shown.category ?? ""}{" "}
                  {d.unconfirmed ? `(today unconfirmed)` : d.value}
                </button>
                {openId === row.id ? (
                  <pre>
                    {JSON.stringify(
                      { prediction: row.prediction, correction: row.correction, transcript: row.transcript },
                      null,
                      2,
                    )}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
