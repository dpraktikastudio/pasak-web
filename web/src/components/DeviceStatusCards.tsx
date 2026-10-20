import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  DEVICE_STATUS_REFRESH_EVENT,
  formatModelSourceLine,
  getFamilyModelStatus,
  MODEL_DELIVERY_EVENT,
  type FamilyModelStatus,
} from "../lib/modelStatus";
import {
  getWarmupState,
  MODEL_WARMUP_EVENT,
  startModelWarmup,
  type WarmupState,
} from "../lib/modelWarmup";
import type { ModelFamily } from "../lib/updates";
import { formatBytes, getPasakStorageStats, type PasakStorageStats } from "../lib/storageStats";

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

function warmupForCard(title: string, warmup: WarmupState): CardWarmup {
  if (warmup.status !== "loading") return { active: false };
  const family: ModelFamily = title === "Whisper" ? "whisper" : "interpreter";
  if (warmup.family !== family) return { active: false };
  return { active: true, label: warmup.label, loaded: warmup.loaded, total: warmup.total };
}

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
  children,
}: {
  title: string;
  subtitle?: string | null;
  warmup?: CardWarmup;
  children: ReactNode;
}) {
  return (
    <section className="status-card status-card--with-footer" role="status" aria-live="polite" aria-label={title}>
      <div className="status-card__head">
        <h2 className="status-card__title">{title}</h2>
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
}: {
  title: string;
  status: FamilyModelStatus | null;
  warmup: CardWarmup;
}) {
  if (!status) {
    return (
      <section className="status-card" aria-label={title}>
        <h2 className="status-card__title">{title}</h2>
        <p className="status-card__muted">Loading…</p>
      </section>
    );
  }

  if (status.kind === "notApplicable") {
    return (
      <section className="status-card" aria-label={title}>
        <h2 className="status-card__title">{title}</h2>
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
      <ModelCardShell title={title} subtitle={modelVersionSubtitle(status)} warmup={warmup}>
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
    <ModelCardShell title={title} subtitle={modelVersionSubtitle(status)} warmup={warmup}>
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

function StorageCard({ stats }: { stats: PasakStorageStats | null }) {
  if (!stats) {
    return (
      <section className="status-card" aria-label="Local storage">
        <h2 className="status-card__title">Storage</h2>
        <p className="status-card__muted">Loading…</p>
      </section>
    );
  }

  const { db, origin } = stats;
  const originPct =
    origin && origin.quota > 0 ? Math.min(100, Math.round((origin.usage / origin.quota) * 100)) : null;

  return (
    <section className="status-card" role="status" aria-label="Local storage">
      <h2 className="status-card__title">Storage</h2>
      <dl className="status-card__rows">
        <div className="status-card__row">
          <dt>Pasak DB (est.)</dt>
          <dd>{formatBytes(db.bytes)}</dd>
        </div>
        <div className="status-card__row">
          <dt>Expenses</dt>
          <dd>{db.expenseCount}</dd>
        </div>
        <div className="status-card__row">
          <dt>Origin usage</dt>
          <dd>
            {origin ? (
              <>
                {formatBytes(origin.usage)} / {formatBytes(origin.quota)}
                {originPct != null ? (
                  <progress className="status-card__meter" value={origin.usage} max={origin.quota} />
                ) : null}
              </>
            ) : (
              <span className="status-card__muted">Quota unavailable</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="status-card__hint">Pasak DB size is an estimate. Origin usage includes IndexedDB and all caches for this site.</p>
    </section>
  );
}

export function DeviceStatusCards() {
  const [warmup, setWarmup] = useState<WarmupState>(() => getWarmupState());
  const [whisper, setWhisper] = useState<FamilyModelStatus | null>(null);
  const [interpreter, setInterpreter] = useState<FamilyModelStatus | null>(null);
  const [storage, setStorage] = useState<PasakStorageStats | null>(null);

  const refresh = useCallback(() => {
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

  useEffect(() => {
    const onWarmup = (e: Event) => {
      const detail = (e as CustomEvent<WarmupState>).detail;
      setWarmup(detail);
      if (detail.status === "done" || detail.status === "error") refresh();
    };
    const onRefresh = () => refresh();
    window.addEventListener(MODEL_WARMUP_EVENT, onWarmup);
    window.addEventListener(MODEL_DELIVERY_EVENT, onRefresh);
    window.addEventListener(DEVICE_STATUS_REFRESH_EVENT, onRefresh);
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    setWarmup(getWarmupState());
    refresh();
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
  }, [refresh]);

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
        <ModelFamilyCard title="Whisper" status={whisper} warmup={warmupForCard("Whisper", warmup)} />
        <ModelFamilyCard
          title="Interpreter"
          status={interpreter}
          warmup={
            manifestWarmup.active
              ? manifestWarmup
              : warmupForCard("Interpreter", warmup)
          }
        />
        <StorageCard stats={storage} />
      </div>
    </div>
  );
}
