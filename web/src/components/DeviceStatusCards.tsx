import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearPasakIndexedDb } from "../lib/db";
import { clearModelCachesB, revalidateModelFamily } from "../lib/modelMaintenance";
import {
  DEVICE_STATUS_REFRESH_EVENT,
  formatModelSourceLine,
  getFamilyModelStatus,
  MODEL_DELIVERY_EVENT,
  notifyDeviceStatusRefresh,
  type FamilyModelStatus,
} from "../lib/modelStatus";
import {
  getWarmupState,
  MODEL_WARMUP_EVENT,
  startModelWarmup,
  type WarmupState,
} from "../lib/modelWarmup";
import { formatBytes, getPasakStorageStats, type PasakStorageStats } from "../lib/storageStats";
import { getFamilyDownloadState, type ModelFamily } from "../lib/updates";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusCardActions, type StatusCardAction } from "./StatusCardActions";

function badgeClass(ok: boolean | null, warn?: boolean): string {
  if (warn) return "status-badge status-badge--warn";
  if (ok === null) return "status-badge status-badge--muted";
  return ok ? "status-badge status-badge--ok" : "status-badge status-badge--warn";
}

type CardWarmup =
  | { active: true; label: string; loaded: number; total?: number }
  | { active: false };

function formatModelSize(downloadedBytes: number | null, totalBytes: number | null): string {
  if (downloadedBytes == null) return "—";
  if (totalBytes != null && totalBytes > downloadedBytes) {
    return `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
  }
  if (totalBytes != null) return formatBytes(totalBytes);
  return formatBytes(downloadedBytes);
}

function modelVersionSubtitle(status: FamilyModelStatus): string | null {
  if (status.kind === "bundled") {
    return `${status.modelName} (${status.modelVersion})`;
  }
  if (status.kind === "manifest") {
    return `${status.modelName} (${status.activeVersion})`;
  }
  return null;
}

function familyFromTitle(title: string): ModelFamily {
  return title === "Whisper" ? "whisper" : "interpreter";
}

function warmupForCard(title: string, warmup: WarmupState): CardWarmup {
  if (warmup.status !== "loading") return { active: false };
  const family = familyFromTitle(title);
  if (warmup.family !== family) return { active: false };
  return { active: true, label: warmup.label, loaded: warmup.loaded, total: warmup.total };
}

function revalidateConfirmBody(familyLabel: string): ReactNode {
  return (
    <>
      <p>
        Re-reads cached files for <strong>{familyLabel}</strong> and checks SHA-256. This can take several
        minutes on a large model. It does not download files if they are intact.
      </p>
      <p>Card stats update when finished.</p>
    </>
  );
}

const REMOVE_MODEL_CACHES_BODY: ReactNode = (
  <>
    <p>
      Deletes model caches: <strong>pasak-models</strong>, <strong>pasak-models-files</strong>, and{" "}
      <strong>transformers-cache</strong>. The app shell cache and IndexedDB are kept.
    </p>
    <p>
      If manifest updates are enabled, models will download again (hundreds of MB). Recording may fail until
      download finishes. ONNX runtime files may be cached again on next use.
    </p>
  </>
);

const CLEAR_IDB_BODY: ReactNode = (
  <>
    <p>
      Deletes <strong>all expenses</strong> and <strong>all meta</strong> in Pasak IndexedDB (consent, install
      id, model version pointers).
    </p>
    <p>Model files in Cache API are not removed. The expense list on this page will empty.</p>
  </>
);

function InCardProgressFooter({ warmup }: { warmup: CardWarmup }) {
  const [mounted, setMounted] = useState(warmup.active);
  const [visible, setVisible] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    label: string;
    loaded: number;
    total?: number;
  } | null>(
    warmup.active
      ? { label: warmup.label, loaded: warmup.loaded, total: warmup.total }
      : null,
  );

  useEffect(() => {
    if (warmup.active) {
      const { label, loaded, total } = warmup;
      setSnapshot({ label, loaded, total });
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), 280);
    return () => window.clearTimeout(timer);
  }, [warmup]);

  if (!mounted || !snapshot) return null;

  return (
    <div
      className={`status-card__progress-footer${visible ? " is-visible" : ""}`}
      aria-busy={warmup.active}
      aria-hidden={!warmup.active && !visible}
    >
      <div className="status-card__progress-inner">
        <p className="status-card__progress-label">{snapshot.label}</p>
        {snapshot.total != null ? (
          <progress className="status-card__meter" value={snapshot.loaded} max={snapshot.total} />
        ) : (
          <progress className="status-card__meter" />
        )}
        <p className="status-card__progress-bytes">
          {formatModelSize(snapshot.loaded, snapshot.total ?? null)}
        </p>
      </div>
    </div>
  );
}

function ModelCardShell({
  title,
  subtitle,
  warmup,
  actions,
  children,
}: {
  title: string;
  subtitle?: string | null;
  warmup?: CardWarmup;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="status-card status-card--with-footer" role="status" aria-live="polite" aria-label={title}>
      <div className="status-card__head">
        <div className="status-card__head-row">
          <h2 className="status-card__title">{title}</h2>
          {actions}
        </div>
        {subtitle ? <p className="status-card__subtitle">{subtitle}</p> : null}
      </div>
      <div className="status-card__body">{children}</div>
      {warmup ? <InCardProgressFooter warmup={warmup} /> : null}
    </section>
  );
}

function ModelFamilyCard({
  title,
  status,
  warmup,
  actions,
}: {
  title: string;
  status: FamilyModelStatus | null;
  warmup: CardWarmup;
  actions: ReactNode;
}) {
  if (!status) {
    return (
      <section className="status-card" aria-label={title}>
        <div className="status-card__head-row">
          <h2 className="status-card__title">{title}</h2>
          {actions}
        </div>
        <p className="status-card__muted">Loading…</p>
      </section>
    );
  }

  if (status.kind === "notApplicable") {
    return (
      <section className="status-card" aria-label={title}>
        <div className="status-card__head-row">
          <h2 className="status-card__title">{title}</h2>
          {actions}
        </div>
        <p className="status-card__muted">{status.reason}</p>
      </section>
    );
  }

  if (status.kind === "bundled") {
    const downloaded = status.sessionLoaded || status.originFileCached === true;
    const cached = status.sessionLoaded || status.originFileCached === true;
    const cachedLabel = status.sessionLoaded
      ? "In memory (this session)"
      : status.originFileCached === true
        ? "Cached on device"
        : "Not cached yet";
    return (
      <ModelCardShell title={title} subtitle={modelVersionSubtitle(status)} warmup={warmup} actions={actions}>
        <dl className="status-card__rows">
          <div className="status-card__row">
            <dt>Source</dt>
            <dd>
              {formatModelSourceLine("Bundled", status.modelName, status.modelVersion)}
            </dd>
          </div>
          <div className="status-card__row">
            <dt>Downloaded</dt>
            <dd>
              <span className={badgeClass(downloaded)}>{downloaded ? "Ready" : "Not yet"}</span>
            </dd>
          </div>
          <div className="status-card__row">
            <dt>Size</dt>
            <dd>{formatModelSize(status.downloadedBytes, null)}</dd>
          </div>
          <div className="status-card__row">
            <dt>Cached</dt>
            <dd>
              <span className={badgeClass(cached, !cached)}>{cachedLabel}</span>
            </dd>
          </div>
          {status.downloading ? (
            <div className="status-card__row">
              <dt>Update</dt>
              <dd><span className="status-badge status-badge--warn">Downloading…</span></dd>
            </div>
          ) : null}
        </dl>
      </ModelCardShell>
    );
  }

  const downloaded = status.verificationUnknown ? null : status.cacheComplete;
  const cached = downloaded;
  return (
    <ModelCardShell title={title} subtitle={modelVersionSubtitle(status)} warmup={warmup} actions={actions}>
      <dl className="status-card__rows">
        <div className="status-card__row">
          <dt>Source</dt>
          <dd>
            {formatModelSourceLine("Manifest", status.modelName, status.activeVersion)}
          </dd>
        </div>
        {status.pendingVersion ? (
          <div className="status-card__row">
            <dt>Pending</dt>
            <dd>
              {formatModelSourceLine("Pending", status.modelName, status.pendingVersion)}
            </dd>
          </div>
        ) : null}
        <div className="status-card__row">
          <dt>Downloaded</dt>
          <dd>
            {status.verificationUnknown ? (
              <span className="status-badge status-badge--muted">Unavailable</span>
            ) : (
              <span className={badgeClass(status.cacheComplete)}>
                {status.filesVerified}/{status.totalFiles} files
              </span>
            )}
          </dd>
        </div>
        <div className="status-card__row">
          <dt>Size</dt>
          <dd>
            {status.verificationUnknown
              ? "—"
              : formatModelSize(status.downloadedBytes, status.totalBytes)}
          </dd>
        </div>
        <div className="status-card__row">
          <dt>Cached</dt>
          <dd>
            {status.verificationUnknown ? (
              <span className="status-badge status-badge--muted">Unavailable</span>
            ) : (
              <span className={badgeClass(cached)}>{cached ? "Verified" : "Incomplete"}</span>
            )}
          </dd>
        </div>
        {status.needsReload ? (
          <div className="status-card__row">
            <dt>Reload</dt>
            <dd><span className="status-badge status-badge--warn">Reload to activate pending</span></dd>
          </div>
        ) : null}
        {status.downloading ? (
          <div className="status-card__row">
            <dt>Update</dt>
            <dd><span className="status-badge status-badge--warn">Downloading…</span></dd>
          </div>
        ) : null}
      </dl>
    </ModelCardShell>
  );
}

function StorageCard({
  stats,
  actions,
}: {
  stats: PasakStorageStats | null;
  actions: ReactNode;
}) {
  if (!stats) {
    return (
      <section className="status-card" aria-label="Local storage">
        <div className="status-card__head-row">
          <h2 className="status-card__title">Storage</h2>
          {actions}
        </div>
        <p className="status-card__muted">Loading…</p>
      </section>
    );
  }

  const { db } = stats;

  return (
    <section className="status-card" role="status" aria-label="Local storage">
      <div className="status-card__head-row">
        <h2 className="status-card__title">Storage</h2>
        {actions}
      </div>
      <dl className="status-card__rows">
        <div className="status-card__row">
          <dt>Pasak DB (est.)</dt>
          <dd>{formatBytes(db.bytes)}</dd>
        </div>
        <div className="status-card__row">
          <dt>Expenses</dt>
          <dd>{db.expenseCount}</dd>
        </div>
      </dl>
      <p className="status-card__hint">Pasak DB size is an estimate from stored expenses and meta.</p>
    </section>
  );
}

function ModelCachesRemoveBar({
  disabled,
  onRemoved,
}: {
  disabled: boolean;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await clearModelCachesB();
      onRemoved();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="status-cards__model-actions">
      <button
        type="button"
        className="status-card__action-btn"
        title="Delete all on-device model caches (both Whisper and Interpreter). IndexedDB is kept."
        aria-label="Delete all on-device model caches (both Whisper and Interpreter). IndexedDB is kept."
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
      >
        Remove all model caches
      </button>
      <ConfirmDialog
        open={open}
        title="Remove all model caches?"
        description={REMOVE_MODEL_CACHES_BODY}
        confirmLabel="Remove caches"
        danger
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
      />
    </div>
  );
}

export type DeviceStatusCardsProps = {
  actionsLocked?: boolean;
};

export function DeviceStatusCards({ actionsLocked = false }: DeviceStatusCardsProps) {
  const [warmup, setWarmup] = useState<WarmupState>(() => getWarmupState());
  const [whisper, setWhisper] = useState<FamilyModelStatus | null>(null);
  const [interpreter, setInterpreter] = useState<FamilyModelStatus | null>(null);
  const [storage, setStorage] = useState<PasakStorageStats | null>(null);

  const refreshAll = useCallback(() => {
    void Promise.all([
      getFamilyModelStatus("whisper"),
      getFamilyModelStatus("interpreter"),
      getPasakStorageStats(),
    ]).then(([w, i, s]) => {
      setWhisper(w);
      setInterpreter(i);
      setStorage(s);
    });
  }, []);

  const refreshWhisper = useCallback(() => {
    void getFamilyModelStatus("whisper").then(setWhisper);
  }, []);

  const refreshInterpreter = useCallback(() => {
    void getFamilyModelStatus("interpreter").then(setInterpreter);
  }, []);

  const refreshStorage = useCallback(() => {
    void getPasakStorageStats().then(setStorage);
  }, []);

  useEffect(() => {
    const onWarmup = (e: Event) => {
      const detail = (e as CustomEvent<WarmupState>).detail;
      setWarmup(detail);
      if (detail.status === "done" || detail.status === "error") refreshAll();
    };
    const onRefresh = () => refreshAll();
    window.addEventListener(MODEL_WARMUP_EVENT, onWarmup);
    window.addEventListener(MODEL_DELIVERY_EVENT, onRefresh);
    window.addEventListener(DEVICE_STATUS_REFRESH_EVENT, onRefresh);
    const onVis = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    document.addEventListener("visibilitychange", onVis);
    setWarmup(getWarmupState());
    refreshAll();
    const manifestUrl = import.meta.env.VITE_MANIFEST_URL;
    void startModelWarmup({
      manifestUrl: typeof manifestUrl === "string" && manifestUrl.length > 0 ? manifestUrl : undefined,
    });
    return () => {
      window.removeEventListener(MODEL_WARMUP_EVENT, onWarmup);
      window.removeEventListener(MODEL_DELIVERY_EVENT, onRefresh);
      window.removeEventListener(DEVICE_STATUS_REFRESH_EVENT, onRefresh);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshAll]);

  const warmupBusy = warmup.status === "loading";
  const downloadBusy =
    getFamilyDownloadState("whisper") === "downloading" ||
    getFamilyDownloadState("interpreter") === "downloading";
  const actionsDisabled = actionsLocked || warmupBusy || downloadBusy;

  const whisperModelActions = useMemo((): StatusCardAction[] => {
    const actions: StatusCardAction[] = [
      {
        id: "refresh",
        label: "Refresh",
        tooltip: "Reload Whisper status from cache and memory (no downloads).",
        onRun: async () => {
          refreshWhisper();
        },
      },
    ];
    if (whisper && whisper.kind !== "notApplicable") {
      actions.push({
        id: "revalidate",
        label: "Revalidate",
        tooltip: "Check cached Whisper files against SHA-256 (slow; no download if intact).",
        confirmTitle: "Revalidate Whisper cache?",
        confirmBody: revalidateConfirmBody("Whisper"),
        confirmLabel: "Revalidate",
        onRun: async () => {
          await revalidateModelFamily("whisper");
          refreshWhisper();
          notifyDeviceStatusRefresh();
        },
      });
    }
    return actions;
  }, [whisper, refreshWhisper]);

  const interpreterModelActions = useMemo((): StatusCardAction[] => {
    const actions: StatusCardAction[] = [
      {
        id: "refresh",
        label: "Refresh",
        tooltip: "Reload Interpreter status from cache and memory (no downloads).",
        onRun: async () => {
          refreshInterpreter();
        },
      },
    ];
    if (interpreter != null && interpreter.kind !== "notApplicable") {
      actions.push({
        id: "revalidate",
        label: "Revalidate",
        tooltip: "Check cached Interpreter files against SHA-256 (slow; no download if intact).",
        confirmTitle: "Revalidate Interpreter cache?",
        confirmBody: revalidateConfirmBody("Interpreter"),
        confirmLabel: "Revalidate",
        onRun: async () => {
          await revalidateModelFamily("interpreter");
          refreshInterpreter();
          notifyDeviceStatusRefresh();
        },
      });
    }
    return actions;
  }, [interpreter, refreshInterpreter]);

  const storageActions = useMemo(
    (): StatusCardAction[] => [
      {
        id: "refresh",
        label: "Refresh",
        tooltip: "Recompute Pasak DB size and expense count from IndexedDB.",
        onRun: async () => {
          refreshStorage();
        },
      },
      {
        id: "clear-idb",
        label: "Clear IDB",
        tooltip: "Delete all expenses and meta in Pasak IndexedDB. Model caches are kept.",
        confirmTitle: "Clear Pasak IndexedDB?",
        confirmBody: CLEAR_IDB_BODY,
        confirmLabel: "Clear database",
        danger: true,
        onRun: async () => {
          await clearPasakIndexedDb();
          refreshStorage();
          refreshWhisper();
          refreshInterpreter();
          notifyDeviceStatusRefresh();
        },
      },
    ],
    [refreshStorage, refreshWhisper, refreshInterpreter],
  );

  const manifestWarmup =
    warmup.status === "loading" && warmup.family === "manifest"
      ? { active: true as const, label: warmup.label, loaded: warmup.loaded, total: warmup.total }
      : { active: false as const };

  return (
    <div className="status-cards-wrap">
      {warmup.status === "error" ? (
        <p className="status-card__hint status-cards-wrap__error" role="status">
          Model setup: {warmup.message}. You can still record; first capture may load models.
        </p>
      ) : null}
      <div className="status-cards">
        <ModelCachesRemoveBar disabled={actionsDisabled} onRemoved={refreshAll} />
        <ModelFamilyCard
          title="Whisper"
          status={whisper}
          warmup={warmupForCard("Whisper", warmup)}
          actions={
            <StatusCardActions actions={whisperModelActions} disabled={actionsDisabled} />
          }
        />
        <ModelFamilyCard
          title="Interpreter"
          status={interpreter}
          warmup={
            manifestWarmup.active
              ? manifestWarmup
              : warmupForCard("Interpreter", warmup)
          }
          actions={
            <StatusCardActions actions={interpreterModelActions} disabled={actionsDisabled} />
          }
        />
        <StorageCard
          stats={storage}
          actions={<StatusCardActions actions={storageActions} disabled={actionsDisabled} />}
        />
      </div>
    </div>
  );
}
