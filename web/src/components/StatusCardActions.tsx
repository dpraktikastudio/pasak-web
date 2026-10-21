import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export type StatusCardAction = {
  id: string;
  label: string;
  tooltip: string;
  confirmTitle?: string;
  confirmBody?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  onRun: () => Promise<void>;
};

type StatusCardActionsProps = {
  actions: StatusCardAction[];
  disabled?: boolean;
};

export function StatusCardActions({ actions, disabled }: StatusCardActionsProps) {
  const [pending, setPending] = useState<StatusCardAction | null>(null);
  const [busy, setBusy] = useState(false);

  const runAction = async (action: StatusCardAction) => {
    setBusy(true);
    try {
      await action.onRun();
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <>
      <div className="status-card__actions" role="group">
        {actions.map((action) => {
          const needsConfirm = Boolean(action.confirmTitle && action.confirmBody);
          const isDisabled = disabled || busy || action.disabled;
          return (
            <button
              key={action.id}
              type="button"
              className="status-card__action-btn"
              title={action.tooltip}
              aria-label={action.tooltip}
              disabled={isDisabled}
              onClick={() => {
                if (needsConfirm) setPending(action);
                else void runAction(action);
              }}
            >
              {action.label}
            </button>
          );
        })}
      </div>
      {pending ? (
        <ConfirmDialog
          open
          title={pending.confirmTitle!}
          description={pending.confirmBody}
          confirmLabel={pending.confirmLabel ?? pending.label}
          danger={pending.danger}
          busy={busy}
          onConfirm={() => void runAction(pending)}
          onCancel={() => {
            if (!busy) setPending(null);
          }}
        />
      ) : null}
    </>
  );
}
