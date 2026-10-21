import { Fragment, useEffect, useRef, useState } from "react";
import { useTheme, type ThemePreference } from "./hooks/useTheme";
import { startPushToTalk, type TalkResult } from "./lib/audio";
import {
  isConsentGranted,
  needsShareUpdate,
  optIn,
  revokeConsent,
  shareExpense,
  shareFingerprint,
} from "./lib/consent";
import { HistoryExpenseDetail } from "./components/HistoryExpenseDetail";
import { listExpenses, PASAK_DATA_CLEARED_EVENT, putExpense, updateExpense } from "./lib/db";
import { createAutoSaveScheduler } from "./lib/reviewAutoSave";
import { localTodayIso } from "./lib/dates";
import type { CaptureProgressSnapshot } from "./lib/captureProgress";
import { DeviceStatusCards } from "./components/DeviceStatusCards";
import { TrainingSharingPanel } from "./components/TrainingSharingPanel";
import { modelChoice } from "./lib/modelChoice";
import { notifyDeviceStatusRefresh } from "./lib/modelStatus";
import { formatMoney, sumIdrExpenses } from "./lib/formatMoney";
import { expenseModelVersions, getActiveVersions } from "./lib/updates";
import type { ExpenseFields, ExpenseRecord } from "./lib/types";

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
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const session = useRef<ReturnType<typeof startPushToTalk> | null>(null);
  const captureGeneration = useRef(0);
  const autoSaveScheduler = useRef(createAutoSaveScheduler());
  const draftRef = useRef(draft);
  const formRef = useRef(form);
  const dateTouchedRef = useRef(dateTouched);
  const savingRef = useRef(false);
  draftRef.current = draft;
  formRef.current = form;
  dateTouchedRef.current = dateTouched;
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

  function cancelAutoSave() {
    autoSaveScheduler.current.cancel();
  }

  function clearDraftPanel() {
    cancelAutoSave();
    setClipUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setDraft(null);
    setForm({
      amount: null,
      currency: null,
      category: null,
      item: null,
      merchant: null,
      date: null,
    });
    setDateTouched(false);
  }

  function canSaveFromRefs(): boolean {
    const d = draftRef.current;
    if (!d || savingRef.current) return false;
    const f = formRef.current;
    const amountOk =
      f.amount !== null && Number.isInteger(f.amount) && f.amount >= 0;
    const currencyOk = Boolean(f.currency && f.currency.trim());
    return amountOk && currencyOk;
  }

  function formForSaveFromRefs(): ExpenseFields | null {
    const d = draftRef.current;
    if (!d) return null;
    const f = formRef.current;
    return {
      amount: f.amount,
      currency: f.currency,
      category: f.category,
      item: f.item === "" ? null : f.item,
      merchant: f.merchant === "" ? null : f.merchant,
      date: dateTouchedRef.current ? f.date : d.prediction.date,
    };
  }

  async function applyCaptureSuccess(result: TalkResult & { ok: true }, generation: number) {
    if (generation !== captureGeneration.current) return;
    const next: ExpenseRecord = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      transcript: result.transcript,
      prediction: result.prediction,
      correction: null,
      modelVersions: expenseModelVersions(await getActiveVersions(), modelChoice),
    };
    setClipUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return result.clipUrl;
    });
    setDraft(next);
    setOpenId(null);
    setForm({ ...result.prediction });
    setDateTouched(false);
    setStatus("");
    notifyDeviceStatusRefresh();
  }

  async function finishCapture(promise: Promise<TalkResult>, generation: number) {
    try {
      const result = await promise;
      if (generation !== captureGeneration.current) return;
      if (!result.ok) {
        setStatus(result.message);
        return;
      }
      await applyCaptureSuccess(result, generation);
    } catch (err) {
      if (generation === captureGeneration.current) {
        setStatus(err instanceof Error ? err.message : "Capture failed.");
      }
    } finally {
      if (generation === captureGeneration.current) {
        setHolding(false);
        setBusy(false);
        setCaptureProgress(null);
        session.current = null;
      }
    }
  }

  async function saveAndClear() {
    const d = draftRef.current;
    if (!d || savingRef.current) return;
    const next = formForSaveFromRefs();
    if (!next) return;
    const amountOk = next.amount !== null && Number.isInteger(next.amount) && next.amount >= 0;
    const currencyOk = Boolean(next.currency && next.currency.trim());
    if (!amountOk || !currencyOk) return;

    const correction = fieldsEqual(next, d.prediction) ? null : next;
    savingRef.current = true;
    setSaving(true);
    cancelAutoSave();
    try {
      await putExpense({
        ...d,
        correction,
      });
      clearDraftPanel();
      setStatus("Saved");
      await reload();
      notifyDeviceStatusRefresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function onRecordClick() {
    if (busy) return;
    if (holding) {
      session.current?.stop();
      return;
    }
    cancelAutoSave();
    setStatus("");
    const generation = ++captureGeneration.current;
    setHolding(true);
    levelsRef.current = [];
    const capture = startPushToTalk({
      onCaptureEnd: () => {
        if (generation !== captureGeneration.current) return;
        setHolding(false);
        setBusy(true);
      },
      onCaptureStage: setCaptureProgress,
      onLevel: (level) => {
        const next = levelsRef.current;
        next.push(level);
        if (next.length > 80) next.shift();
      },
    });
    session.current = capture;
    void finishCapture(capture.finished, generation);
  }

  useEffect(() => {
    return () => {
      cancelAutoSave();
    };
  }, []);

  useEffect(() => {
    if (!draft) {
      cancelAutoSave();
      return;
    }
    const draftId = draft.id;
    autoSaveScheduler.current.schedule(() => {
      if (draftRef.current?.id !== draftId) return;
      if (!canSaveFromRefs()) {
        setStatus("Add amount and currency to save.");
        return;
      }
      void saveAndClear();
    });
    return () => cancelAutoSave();
  }, [draft, form, dateTouched, draft?.transcript]);

  async function onOptIn(): Promise<boolean> {
    setConsentBusy(true);
    try {
      await optIn();
      setConsentGranted(true);
      setStatus("");
      return true;
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Opt-in failed.");
      return false;
    } finally {
      setConsentBusy(false);
    }
  }

  async function onShareExpense(row: ExpenseRecord) {
    setSharingId(row.id);
    try {
      const result = await shareExpense(row);
      if (result.error) {
        setStatus(result.error);
        return;
      }
      const fp = shareFingerprint(row);
      await updateExpense(row.id, {
        lastSharedAt: new Date().toISOString(),
        sharedExampleId: result.id ?? row.sharedExampleId ?? null,
        sharedFingerprint: fp,
      });
      await reload();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Share failed.");
    } finally {
      setSharingId(null);
    }
  }

  async function onHistorySave(
    id: string,
    patch: { transcript: string; correction: ExpenseFields | null },
  ) {
    await updateExpense(id, patch);
    await reload();
  }

  async function onRevoke() {
    setConsentBusy(true);
    try {
      const result = await revokeConsent();
      if (result.error) setStatus(result.error);
      else {
        setConsentGranted(false);
        setStatus("");
        await reload();
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Revoke failed.");
    } finally {
      setConsentBusy(false);
    }
  }

  function onSaveNow() {
    if (!canSave) return;
    void saveAndClear();
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
          <p>
            Tap to record and speak. Tap again to finish early, or pause about 2 seconds when done.
            Models stay on this device.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <DeviceStatusCards actionsLocked={busy || consentBusy || sharingId !== null} />

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
                aria-busy={busy && !holding}
                onClick={onRecordClick}
              >
                {holding ? "Tap to finish" : "Tap to record"}
              </button>
              {holding ? (
                <p className="capture-listening" role="status" aria-live="polite">
                  Listening…
                </p>
              ) : null}
              {busy && !holding ? (
                <div className="transcribe-status" role="status" aria-live="polite" aria-busy="true">
                  <p className="transcribe-status__row">
                    <span className="spinner" aria-hidden />
                    <span>{captureProgress?.label ?? "Processing…"}</span>
                    {captureProgress ? (
                      <span className="capture-step-hint">
                        Step {captureProgress.step} of {captureProgress.steps}
                      </span>
                    ) : null}
                  </p>
                  {captureProgress ? (
                    <progress
                      className="capture-step-bar"
                      value={captureProgress.step}
                      max={captureProgress.steps}
                    />
                  ) : null}
                </div>
              ) : null}
              {holding ? (
                <canvas
                  ref={meterRef}
                  className="level-meter"
                  width={320}
                  height={48}
                  aria-hidden
                />
              ) : null}
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
              <button type="button" disabled={!canSave} onClick={() => onSaveNow()}>
                Save now
              </button>
            </section>
          ) : (
            <section className="panel">
              <p className="empty-hint">Record a expense to review transcript and fields here.</p>
            </section>
          )}
        </div>

        <div className="col-history">
          <TrainingSharingPanel
            consentGranted={consentGranted}
            busy={consentBusy}
            disabled={busy || sharingId !== null}
            onEnable={() => void onOptIn()}
            onDisable={() => void onRevoke()}
          />
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
                              <td className="expenses-table__date-cell">
                                <span className="expenses-table__date-text">
                                  {d.unconfirmed ? `${d.value}*` : d.value}
                                </span>
                                {consentGranted && row.lastSharedAt ? (
                                  <span
                                    className={`expenses-table__shared-icon${
                                      needsShareUpdate(row)
                                        ? " expenses-table__shared-icon--stale"
                                        : ""
                                    }`}
                                    title={
                                      needsShareUpdate(row)
                                        ? "Shared; local changes not sent yet"
                                        : "Shared for training"
                                    }
                                    aria-label={
                                      needsShareUpdate(row)
                                        ? "Shared, update pending"
                                        : "Shared for training"
                                    }
                                  >
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden
                                    >
                                      <path d="M4 14.9A7 7 0 1 1 15.7 8.3" />
                                      <path d="M12 12v9" />
                                      <path d="m16 16-4-4-4 4" />
                                    </svg>
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                            {isOpen ? (
                              <tr key={`${row.id}-detail`} className="expenses-table__detail">
                                <td colSpan={3}>
                                  <div className="expenses-table__detail-inner">
                                    <HistoryExpenseDetail
                                      row={row}
                                      consentGranted={consentGranted}
                                      consentBusy={consentBusy}
                                      shareBusy={sharingId === row.id}
                                      onSave={(patch) => onHistorySave(row.id, patch)}
                                      onShare={(record) => onShareExpense(record)}
                                    />
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
