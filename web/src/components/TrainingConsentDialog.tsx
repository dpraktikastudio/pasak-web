import { useEffect, useRef, useState } from "react";
import {
  TRAINING_LEGAL_VERSION,
  TRAINING_PRIVACY_POLICY,
  TRAINING_TERMS,
} from "../lib/trainingConsentLegal";

export type TrainingConsentDialogProps = {
  open: boolean;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

function LegalBlock({
  title,
  sections,
}: {
  title: string;
  sections: { heading: string; body: string }[];
}) {
  return (
    <section className="legal-dialog__block">
      <h4 className="legal-dialog__block-title">{title}</h4>
      {sections.map((s) => (
        <div key={s.heading} className="legal-dialog__section">
          <h5 className="legal-dialog__section-heading">{s.heading}</h5>
          <p>{s.body}</p>
        </div>
      ))}
    </section>
  );
}

export function TrainingConsentDialog({
  open,
  busy,
  onAccept,
  onDecline,
}: TrainingConsentDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (open) setAgreed(false);
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog legal-dialog"
      aria-labelledby="training-consent-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onDecline();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onDecline();
      }}
    >
      <div className="confirm-dialog__panel legal-dialog__panel">
        <h3 id="training-consent-title" className="confirm-dialog__title">
          Enable sharing for training?
        </h3>
        <p className="legal-dialog__intro">
          Review the policy and terms. Sharing stays off until you agree.
        </p>
        <div className="legal-dialog__scroll">
          <LegalBlock title={TRAINING_PRIVACY_POLICY.title} sections={TRAINING_PRIVACY_POLICY.sections} />
          <LegalBlock title={TRAINING_TERMS.title} sections={TRAINING_TERMS.sections} />
          <p className="legal-dialog__version">Version {TRAINING_LEGAL_VERSION}</p>
        </div>
        <div className="legal-dialog__agree">
          <input
            id="training-consent-agree"
            type="checkbox"
            className="legal-dialog__checkbox"
            checked={agreed}
            disabled={busy}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <label htmlFor="training-consent-agree" className="legal-dialog__agree-label">
            I agree to the privacy policy and terms
          </label>
        </div>
        <div className="confirm-dialog__actions legal-dialog__actions">
          <button type="button" className="confirm-dialog__btn" disabled={busy} onClick={onDecline}>
            Decline
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--primary"
            disabled={busy || !agreed}
            onClick={onAccept}
          >
            {busy ? "Working…" : "Agree and turn on"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
