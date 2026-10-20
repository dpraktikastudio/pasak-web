import { Fragment, useEffect, useRef, useState } from "react";
import { useTheme, type ThemePreference } from "./hooks/useTheme";
import { startPushToTalk } from "./lib/audio";
import { canSync, isConsentGranted, optIn, revokeConsent, syncCorrection } from "./lib/consent";
import { listExpenses, PASAK_DATA_CLEARED_EVENT, putExpense, saveCorrection } from "./lib/db";
import { localTodayIso } from "./lib/dates";
import type { CaptureProgressSnapshot } from "./lib/captureProgress";
import { DeviceStatusCards } from "./components/DeviceStatusCards";
import { modelChoice } from "./lib/modelChoice";
import { notifyDeviceStatusRefresh } from "./lib/modelStatus";
import { formatMoney, sumIdrExpenses } from "./lib/formatMoney";
import { expenseModelVersions, getActiveVersions } from "./lib/updates";
import type { ExpenseFields, ExpenseRecord } from "./lib/types";

/** Shown in expand detail; category/merchant stay in data model but hidden in UI (Option A). */
const DETAIL_FIELD_KEYS: (keyof ExpenseFields)[] = [
  "amount",
  "currency",
  "item",
  "date",
];

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function fieldsEqual(a: ExpenseFields, b: ExpenseFields): boolean {
  return (
    a.amount === b.amount &&
    a.currency === b.currency &&
    a.category === b.category &&
    a.item === b.item &&
    a.merchant === b.merchant &&
    a.date === b.date
  );
}

function displayDate(stored: string | null, today: string): { value: string; unconfirmed: boolean } {
  if (stored) return { value: stored, unconfirmed: false };
  return { value: today, unconfirmed: true };
}

function showField(key: keyof ExpenseFields, value: string | number | null, currency: string | null): string {
  if (value === null) return "—";
  if (key === "amount" && typeof value === "number") return formatMoney(value, currency);
  return String(value);
}

function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={preference === opt.value}
          title={`Theme: ${opt.label}`}
          onClick={() => setPreference(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const [rows, setRows] = useState<ExpenseRecord[]>([]);
  const [status, setStatus] = useState("");
  const [holding, setHolding] = useState(false);
  const [captureProgress, setCaptureProgress] = useState<CaptureProgressSnapshot | null>(null);
  const [draft, setDraft] = useState<ExpenseRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseFields>({
    amount: null,
    currency: null,
    category: null,
    item: null,
    merchant: null,
    date: null,
  });
  const [dateTouched, setDateTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consentGranted, setConsentGranted] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const session = useRef<ReturnType<typeof startPushToTalk> | null>(null);
  const savingRef = useRef(false);
  const meterRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<number[]>([]);
  const meterBarColorRef = useRef("#3a9b8f");
  const today = localTodayIso();

  async function reload() {
    setRows(await listExpenses());
  }

  useEffect(() => {
    void reload();
    void isConsentGranted().then(setConsentGranted);
  }, []);

  useEffect(() => {
    const onDataCleared = () => {
      void reload();
      void isConsentGranted().then(setConsentGranted);
    };
    window.addEventListener(PASAK_DATA_CLEARED_EVENT, onDataCleared);
    return () => window.removeEventListener(PASAK_DATA_CLEARED_EVENT, onDataCleared);
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
      item: form.item === "" ? null : form.item,
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
    const barColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--meter-bar")
      .trim();
    meterBarColorRef.current = barColor || "#3a9b8f";
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
      ctx.fillStyle = meterBarColorRef.current;
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
      setCaptureProgress(null);
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
      notifyDeviceStatusRefresh();
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
      onCaptureStage: setCaptureProgress,
      onLevel: (level) => {
        const next = levelsRef.current;
        next.push(level);
        if (next.length > 80) next.shift();
      },
    });
  }

  async function onOptIn() {
    setConsentBusy(true);
    try {
      await optIn();
      setConsentGranted(true);
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Opt-in failed.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function onSyncRow(row: ExpenseRecord) {
    setConsentBusy(true);
    try {
      const result = await syncCorrection(row);
      if (result.error) setStatus(result.error);
      else setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setConsentBusy(false);
    }
  }

  async function onRevoke() {
    setConsentBusy(true);
    try {
      const result = await revokeConsent();
      if (result.error) setStatus(result.error);
      else {
        setConsentGranted(false);
        setStatus("");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setConsentBusy(false);
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
      notifyDeviceStatusRefresh();
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

  const historyFields = rows.map((row) => row.correction ?? row.prediction);
  const totalIdr = sumIdrExpenses(historyFields);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <h1>pasak-web</h1>
          <p>Tap to record, speak, tap again to stop. Models stay on this device.</p>
        </div>
        <ThemeToggle />
      </header>

      <DeviceStatusCards actionsLocked={busy || consentBusy} />

      <div className="app-columns">
        <div className="col-capture">
          <section className="panel">
            <h2>Record</h2>
            <div className="capture-block">
              <button
                type="button"
                className="btn-record"
                disabled={busy}
                aria-pressed={holding}
                onClick={onRecordClick}
              >
                {holding
                  ? "Tap to stop"
                  : busy
                    ? (captureProgress?.label ?? "Working…")
                    : "Tap to record"}
              </button>
              {busy && captureProgress ? (
                <div className="transcribe-status" role="status" aria-live="polite" aria-busy="true">
                  <p className="transcribe-status__row">
                    <span className="spinner" aria-hidden />
                    <span>{captureProgress.label}</span>
                    <span className="capture-step-hint">
                      Step {captureProgress.step} of {captureProgress.steps}
                    </span>
                  </p>
                  <progress
                    className="capture-step-bar"
                    value={captureProgress.step}
                    max={captureProgress.steps}
                  />
                </div>
              ) : busy ? (
                <p className="transcribe-status" role="status" aria-live="polite" aria-busy="true">
                  <span className="spinner" aria-hidden />
                  Working…
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
              {status ? (
                <p className="status-message" role="status">
                  {status}
                </p>
              ) : null}
            </div>
          </section>

          {draft ? (
            <section className="panel">
              <h2>Current</h2>
              {clipUrl ? (
                <label>
                  Playback (16 kHz clip sent to Whisper, this session only)
                  <audio controls src={clipUrl} />
                </label>
              ) : (
                <p className="empty-hint">No clip in memory. Record again to hear what Whisper got.</p>
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
              {form.amount !== null && currencyOk ? (
                <p className="progress-line">{formatMoney(form.amount, form.currency)}</p>
              ) : null}
              <label>
                Currency
                <input
                  value={form.currency ?? ""}
                  onChange={(e) => setForm({ ...form, currency: e.target.value || null })}
                />
              </label>
              {currencyErr ? <p role="alert">{currencyErr}</p> : null}
              <label>
                Item
                <input
                  value={form.item ?? ""}
                  onChange={(e) => setForm({ ...form, item: e.target.value || null })}
                />
              </label>
              <label>
                Date{" "}
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
              <div className="consent-row">
                <button type="button" disabled={consentBusy} onClick={() => void onOptIn()}>
                  opt in
                </button>
                <button
                  type="button"
                  disabled={consentBusy || !canSync(draft, consentGranted)}
                  onClick={() => void onSyncRow(draft)}
                >
                  sync this correction
                </button>
                <button type="button" disabled={consentBusy} onClick={() => void onRevoke()}>
                  revoke
                </button>
              </div>
            </section>
          ) : (
            <section className="panel">
              <p className="empty-hint">Record a expense to review transcript and fields here.</p>
            </section>
          )}
        </div>

        <div className="col-history">
          <section className="panel">
            <h2>Past</h2>
            {rows.length === 0 ? (
              <p className="empty-hint">No expenses yet.</p>
            ) : (
              <>
                <div className="history-analytics">
                  <p className="history-analytics__label">Total expenses (IDR)</p>
                  <p className="history-analytics__value">{formatMoney(totalIdr, "IDR")}</p>
                </div>
                <div className="expenses-table-wrap">
                  <table className="expenses-table">
                    <thead>
                      <tr>
                        <th>Amount</th>
                        <th>Item</th>
                        <th>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const shown = row.correction ?? row.prediction;
                        const d = displayDate(shown.date, today);
                        const isOpen = openId === row.id;
                        return (
                          <Fragment key={row.id}>
                            <tr
                              className={`expenses-table__row${isOpen ? " expenses-table__row--open" : ""}`}
                              tabIndex={0}
                              role="button"
                              aria-expanded={isOpen}
                              onClick={() => setOpenId(isOpen ? null : row.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setOpenId(isOpen ? null : row.id);
                                }
                              }}
                            >
                              <td className="amount-cell">{formatMoney(shown.amount, shown.currency)}</td>
                              <td>{shown.item ?? "—"}</td>
                              <td>{d.unconfirmed ? `${d.value}*` : d.value}</td>
                            </tr>
                            {isOpen ? (
                              <tr key={`${row.id}-detail`} className="expenses-table__detail">
                                <td colSpan={3}>
                                  <div className="expenses-table__detail-inner">
                                    <p className="progress-line">{row.transcript}</p>
                                    <table>
                                      <thead>
                                        <tr>
                                          <th>field</th>
                                          <th>prediction</th>
                                          <th>correction</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {DETAIL_FIELD_KEYS.map((key) => (
                                          <tr key={key}>
                                            <td>{key}</td>
                                            <td>
                                              {showField(key, row.prediction[key], row.prediction.currency)}
                                            </td>
                                            <td>
                                              {row.correction
                                                ? showField(key, row.correction[key], row.correction.currency)
                                                : "—"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                    <div className="consent-row">
                                      <button
                                        type="button"
                                        disabled={consentBusy}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void onOptIn();
                                        }}
                                      >
                                        opt in
                                      </button>
                                      <button
                                        type="button"
                                        disabled={consentBusy || !canSync(row, consentGranted)}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void onSyncRow(row);
                                        }}
                                      >
                                        sync this correction
                                      </button>
                                      <button
                                        type="button"
                                        disabled={consentBusy}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void onRevoke();
                                        }}
                                      >
                                        revoke
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="progress-line">* date unconfirmed (defaults to today)</p>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
