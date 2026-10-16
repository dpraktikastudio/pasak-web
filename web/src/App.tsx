import { useEffect, useRef, useState } from "react";
import { startPushToTalk } from "./lib/audio";
import { listExpenses, putExpense, saveCorrection } from "./lib/db";
import { localTodayIso } from "./lib/dates";
import { interpreterVersionLabel, modelChoice, sttVersionLabel } from "./lib/modelChoice";
import { expenseModelVersions, getActiveVersions } from "./lib/updates";
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
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const session = useRef<ReturnType<typeof startPushToTalk> | null>(null);
  const savingRef = useRef(false);
  const meterRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<number[]>([]);
  const today = localTodayIso();

  async function reload() {
    setRows(await listExpenses());
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    return () => {
      if (clipUrl) URL.revokeObjectURL(clipUrl);
    };
  }, [clipUrl]);

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

  useEffect(() => {
    if (!holding) {
      levelsRef.current = [];
      const c = meterRef.current;
      if (c) {
        const ctx = c.getContext("2d");
        ctx?.clearRect(0, 0, c.width, c.height);
      }
      return;
    }
    let raf = 0;
    const draw = () => {
      const canvas = meterRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const levels = levelsRef.current;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#111";
      const barW = w / 80;
      for (let i = 0; i < levels.length; i++) {
        const amp = Math.min(1, levels[i] * 18);
        const bh = Math.max(2, amp * h);
        ctx.fillRect(i * barW, (h - bh) / 2, Math.max(1, barW - 1), bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [holding]);

  async function stopRecording() {
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
        modelVersions: expenseModelVersions(await getActiveVersions(), modelChoice),
      };
      if (clipUrl) URL.revokeObjectURL(clipUrl);
      setClipUrl(result.clipUrl);
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

  function onRecordClick() {
    if (busy) return;
    if (holding) {
      void stopRecording();
      return;
    }
    setStatus("");
    setHolding(true);
    levelsRef.current = [];
    session.current = startPushToTalk({
      onProgress: (loaded, total) => setProgress({ loaded, total }),
      onLevel: (level) => {
        const next = levelsRef.current;
        next.push(level);
        if (next.length > 80) next.shift();
      },
    });
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
        Tap to record, speak, tap again to stop. Models stay on this device (
        <code>{sttVersionLabel}</code>
        {interpreterVersionLabel ? `, ${interpreterVersionLabel}` : ", rules-only"}).
      </p>
      <button
        type="button"
        disabled={busy}
        aria-pressed={holding}
        onClick={onRecordClick}
      >
        {holding ? "Tap to stop" : busy ? "Transcribing…" : "Tap to record"}
      </button>
      {busy ? (
        <p className="transcribe-status" role="status" aria-live="polite" aria-busy="true">
          <span className="spinner" aria-hidden />
          Transcribing… Whisper can take a while on first load.
        </p>
      ) : null}
      <canvas
        ref={meterRef}
        className="level-meter"
        width={320}
        height={48}
        hidden={!holding}
        aria-hidden
      />
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
          {clipUrl ? (
            <label>
              Playback (16 kHz clip sent to Whisper, this session only)
              <audio controls src={clipUrl} />
            </label>
          ) : (
            <p>No clip in memory. Record again to hear what Whisper got.</p>
          )}
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
