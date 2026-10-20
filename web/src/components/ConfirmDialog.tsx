import { useEffect, useRef, type ReactNode } from "react";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onCancel();
      }}
    >
      <form method="dialog" className="confirm-dialog__panel" onSubmit={(e) => e.preventDefault()}>
        <h3 className="confirm-dialog__title">{title}</h3>
        <div className="confirm-dialog__body">{description}</div>
        <div className="confirm-dialog__actions">
          <button type="button" className="confirm-dialog__btn" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`confirm-dialog__btn${danger ? " confirm-dialog__btn--danger" : " confirm-dialog__btn--primary"}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
