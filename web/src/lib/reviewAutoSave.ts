export const AUTO_SAVE_DELAY_MS = 5000;

export type ReviewEditFingerprint = {
  transcript: string;
  form: {
    amount: number | null;
    currency: string | null;
    item: string | null;
    date: string | null;
  };
  dateTouched: boolean;
};

export function reviewEditFingerprint(
  transcript: string,
  form: ReviewEditFingerprint["form"],
  dateTouched: boolean,
): string {
  return JSON.stringify({ transcript, form, dateTouched });
}

/** Schedules `onFire` after `delayMs`; returns cancel. Rescheduling replaces the pending timer. */
export function createAutoSaveScheduler(delayMs: number = AUTO_SAVE_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(onFire: () => void) {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onFire();
      }, delayMs);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    hasPending(): boolean {
      return timer !== null;
    },
  };
}
