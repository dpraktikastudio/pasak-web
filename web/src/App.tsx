import { useEffect, useRef, useState, type PointerEvent } from "react";
import { startPushToTalk } from "./lib/audio";
import { listExpenses, putExpense, saveCorrection } from "./lib/db";
import { localTodayIso } from "./lib/dates";
import { interpreterVersionLabel, sttVersionLabel } from "./lib/modelChoice";
import type { Category, ExpenseFields, ExpenseRecord } from "./lib/types";

const CATEGORIES: Category[] = ["food", "transport", "bills", "shopping", "health", "other"];
const FIELD_KEYS: (keyof ExpenseFields)[] = ["amount", "currency", "category", "merchant", "date"];

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

function showField(value: string | number | null): string {
  return value === null ? "null" : String(value);
}

export function App() {
  const [rows, setRows] = useState<ExpenseRecord[]>([]);
  const [status, setStatus] = useState("");
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total?: number } | null>(null);
  const [draft, setDraft] = useState<ExpenseRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseFields>({
    amount: null,
    currency: null,
    category: null,
    merchant: null,
    date: null,
  });
  const [dateTouched, setDateTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const session = useRef<ReturnType<typeof startPushToTalk> | null>(null);
  const savingRef = useRef(false);
  const today = localTodayIso();

  async function reload() {
    setRows(await listExpenses());
  }

  useEffect(() => {
    void reload();
  }, []);

  const amountOk = form.amount !== null && Number.isInteger(form.amount) && form.amount >= 0;
  const currencyOk = Boolean(form.currency && form.currency.trim());
  const canSave = amountOk && currencyOk && !saving && draft !== null;

  function formForSave(): ExpenseFields {
    if (!draft) return form;
    return {
      amount: form.amount,
      currency: form.currency,
      category: form.category,
      merchant: form.merchant === "" ? null : form.merchant,
      date: dateTouched ? form.date : draft.prediction.date,
    };
  }

  async function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (holding || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStatus("");
    setHolding(true);
    session.current = startPushToTalk({
      onProgress: (loaded, total) => setProgress({ loaded, total }),
    });
  }

  async function onPointerUp() {
    const s = session.current;
    session.current = null;
    setHolding(false);
    if (!s) return;
    setBusy(true);
    try {
      const result = await s.stop();
      setProgress(null);
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      const next: ExpenseRecord = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        transcript: result.transcript,
        prediction: result.prediction,
        correction: null,
        modelVersions: { stt: sttVersionLabel, interpreter: interpreterVersionLabel },
      };
      setDraft(next);
      setSaved(false);
      setOpenId(null);
      setForm({ ...result.prediction });
      setDateTouched(false);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Capture failed.");
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (!canSave || !draft || savingRef.current) return;
    const next = formForSave();
    const correction = fieldsEqual(next, draft.prediction) ? null : next;
    savingRef.current = true;
    setSaving(true);
    try {
      if (!saved) {
        await putExpense({
          ...draft,
          correction,
        });
        setSaved(true);
      } else {
        await saveCorrection(draft.id, correction);
      }
      setDraft({ ...draft, correction });
      await reload();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const dateUi = displayDate(dateTouched ? form.date : (draft?.prediction.date ?? null), today);
  const amountErr = draft && !amountOk ? "Amount must be a whole number 0 or greater." : null;
  const currencyErr = draft && !currencyOk ? "Currency is required." : null;

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
        disabled={busy}
        onPointerDown={(e) => void onPointerDown(e)}
        onPointerUp={() => void onPointerUp()}
        onPointerCancel={() => void onPointerUp()}
      >
        {holding ? "Recording…" : busy ? "Transcribing…" : "Hold to record"}
      </button>
      {progress ? (
        <p>
          {progress.total != null ? (
            <progress value={progress.loaded} max={progress.total} />
          ) : (
            <progress />
          )}{" "}
          {progress.loaded}
          {progress.total != null ? ` / ${progress.total}` : " bytes"}
        </p>
      ) : null}
      {status ? <p role="status">{status}</p> : null}

      {draft ? (
        <section>
          <h2>Current</h2>
          <label>
            Transcript
            <textarea
              value={draft.transcript}
              onChange={(e) => setDraft({ ...draft, transcript: e.target.value })}
            />
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
          {amountErr ? <p role="alert">{amountErr}</p> : null}
          <label>
            Currency
            <input
              value={form.currency ?? ""}
              onChange={(e) => setForm({ ...form, currency: e.target.value || null })}
            />
          </label>
          {currencyErr ? <p role="alert">{currencyErr}</p> : null}
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
                  {d.unconfirmed ? "(today unconfirmed)" : d.value}
                </button>
                {openId === row.id ? (
                  <div>
                    <table>
                      <thead>
                        <tr>
                          <th>field</th>
                          <th>prediction</th>
                          <th>correction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {FIELD_KEYS.map((key) => (
                          <tr key={key}>
                            <td>{key}</td>
                            <td>{showField(row.prediction[key])}</td>
                            <td>{row.correction ? showField(row.correction[key]) : "null"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
