import { useEffect, useState } from "react";
import { localTodayIso } from "../lib/dates";
import {
  canShareExpense,
  getApiOrigin,
  needsShareUpdate,
  shownExpenseFields,
} from "../lib/consent";
import type { ExpenseFields, ExpenseRecord } from "../lib/types";

type Props = {
  row: ExpenseRecord;
  consentGranted: boolean;
  consentBusy: boolean;
  shareBusy: boolean;
  onSave: (patch: {
    transcript: string;
    correction: ExpenseFields | null;
  }) => Promise<void>;
  onShare: (record: ExpenseRecord) => Promise<void>;
};

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

export function HistoryExpenseDetail({
  row,
  consentGranted,
  consentBusy,
  shareBusy,
  onSave,
  onShare,
}: Props) {
  const today = localTodayIso();
  const shown = shownExpenseFields(row);
  const [transcript, setTranscript] = useState(row.transcript);
  const [amount, setAmount] = useState<string>(shown.amount?.toString() ?? "");
  const [currency, setCurrency] = useState(shown.currency ?? "");
  const [item, setItem] = useState(shown.item ?? "");
  const [date, setDate] = useState(shown.date ?? today);
  const [dateTouched, setDateTouched] = useState(Boolean(shown.date));
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    const next = shownExpenseFields(row);
    setTranscript(row.transcript);
    setAmount(next.amount?.toString() ?? "");
    setCurrency(next.currency ?? "");
    setItem(next.item ?? "");
    setDate(next.date ?? today);
    setDateTouched(Boolean(next.date));
  }, [row, today]);

  const amountNum = amount === "" ? null : Number(amount);
  const amountOk = amountNum !== null && Number.isInteger(amountNum) && amountNum >= 0;
  const currencyOk = Boolean(currency.trim());
  const canSaveLocal = amountOk && currencyOk && !saveBusy;

  function buildLocalRecord(): ExpenseRecord {
    const base = shownExpenseFields(row);
    const edited: ExpenseFields = {
      ...base,
      amount: amountNum,
      currency: currency.trim() || null,
      item: item.trim() || null,
      date: dateTouched ? date || null : row.prediction.date,
    };
    const correction = fieldsEqual(edited, row.prediction) ? null : edited;
    return { ...row, transcript, correction };
  }

  async function handleSave() {
    if (!canSaveLocal) return;
    setSaveBusy(true);
    try {
      const local = buildLocalRecord();
      await onSave({ transcript: local.transcript, correction: local.correction });
    } finally {
      setSaveBusy(false);
    }
  }

  const localRecord = buildLocalRecord();
  const shareReady = canShareExpense(localRecord, consentGranted);

  let shareLabel = "Share for training";
  let shareDisabled = true;
  if (!getApiOrigin()) {
    shareLabel = "Sharing unavailable";
  } else if (!consentGranted) {
    shareLabel = "Turn on sharing above Past";
  } else if (!shareReady) {
    shareLabel = "Set amount and currency to share";
  } else if (row.lastSharedAt && !needsShareUpdate(localRecord)) {
    shareLabel = "Shared";
    shareDisabled = true;
  } else if (row.lastSharedAt) {
    shareLabel = "Update shared copy";
    shareDisabled = shareBusy || consentBusy;
  } else {
    shareDisabled = shareBusy || consentBusy;
  }

  const shareHint =
    row.lastSharedAt && !needsShareUpdate(localRecord)
      ? "This expense matches the last shared copy."
      : null;

  return (
    <div
      className="history-detail-form"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <label>
        Transcript
        <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} />
      </label>
      <label>
        Amount
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
        />
      </label>
      <label>
        Currency
        <input value={currency} onChange={(e) => setCurrency(e.target.value)} />
      </label>
      <label>
        Item
        <input value={item} onChange={(e) => setItem(e.target.value)} />
      </label>
      <label>
        Date
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDateTouched(true);
            setDate(e.target.value);
          }}
        />
      </label>
      <div className="history-detail-form__actions">
        <button type="button" disabled={!canSaveLocal} onClick={() => void handleSave()}>
          {saveBusy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={shareDisabled}
          onClick={() => void onShare(buildLocalRecord())}
          className="history-detail-form__share"
        >
          {shareLabel}
        </button>
      </div>
      {shareHint ? <p className="empty-hint">{shareHint}</p> : null}
    </div>
  );
}
