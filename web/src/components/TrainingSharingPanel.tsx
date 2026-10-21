import { useState, type ReactNode } from "react";
import { getApiOrigin } from "../lib/consent";
import { ConfirmDialog } from "./ConfirmDialog";
import { TrainingConsentDialog } from "./TrainingConsentDialog";

const REVOKE_BODY: ReactNode = (
  <p>Stops sharing and removes your examples from the server. Local expenses stay on this device.</p>
);

export type TrainingSharingPanelProps = {
  consentGranted: boolean;
  busy: boolean;
  disabled?: boolean;
  onEnable: () => void | Promise<void | boolean>;
  onDisable: () => void | Promise<void>;
};

export function TrainingSharingPanel({
  consentGranted,
  busy,
  disabled = false,
  onEnable,
  onDisable,
}: TrainingSharingPanelProps) {
  const origin = getApiOrigin();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);

  if (!origin) {
    return (
      <section className="panel panel--compact training-sharing" aria-label="Training data">
        <p className="training-sharing__unavailable">
          Sharing needs <code>VITE_MANIFEST_URL</code> (preview + API).
        </p>
      </section>
    );
  }

  const locked = disabled || busy;

  return (
    <section className="panel panel--compact training-sharing" aria-label="Training data">
      <div className="training-sharing__row">
        <div className="training-sharing__text">
          <span className="training-sharing__title">Share for training</span>
          <span className="training-sharing__hint">Scrubbed text only</span>
        </div>
        <button
          type="button"
          role="switch"
          className={`training-sharing__switch${consentGranted ? " is-on" : ""}`}
          aria-checked={consentGranted}
          aria-label={consentGranted ? "Sharing on" : "Sharing off"}
          disabled={locked}
          onClick={() => {
            if (consentGranted) setRevokeOpen(true);
            else setConsentOpen(true);
          }}
        />
      </div>
      <TrainingConsentDialog
        open={consentOpen}
        busy={busy}
        onDecline={() => {
          if (!busy) setConsentOpen(false);
        }}
        onAccept={() => {
          void (async () => {
            const ok = await onEnable();
            if (ok !== false) setConsentOpen(false);
          })();
        }}
      />
      <ConfirmDialog
        open={revokeOpen}
        title="Turn off sharing?"
        description={REVOKE_BODY}
        confirmLabel="Turn off"
        danger
        busy={busy}
        onConfirm={() => {
          void Promise.resolve(onDisable()).finally(() => setRevokeOpen(false));
        }}
        onCancel={() => {
          if (!busy) setRevokeOpen(false);
        }}
      />
    </section>
  );
}
