"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@librehr/ui";

/** Shortest reopen reason, matching the API rule (TIM-004). */
const MIN_REASON = 5;
const MAX_REASON = 1000;

export interface ReopenMonthDialogProps {
  open: boolean;
  /** Employee and month being reopened. */
  subject: string;
  submitting: boolean;
  /** Why the last attempt failed, shown inside the dialog so it is seen. */
  failure?: string | undefined;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}

/**
 * TIM-004: reopening a closed month needs a reason, which is kept in the
 * closure history. An empty or too short reason never reaches the API.
 */
export function ReopenMonthDialog({
  open,
  subject,
  submitting,
  failure,
  onOpenChange,
  onConfirm,
}: ReopenMonthDialogProps) {
  const t = useTranslations("timeTracking");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState(false);
  const fieldRef = React.useRef<HTMLTextAreaElement>(null);
  const fieldId = React.useId();
  const errorId = React.useId();

  React.useEffect(() => {
    if (open) {
      setReason("");
      setError(false);
    }
  }, [open]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON) {
      setError(true);
      fieldRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("reopenTitle")}</DialogTitle>
            <DialogDescription>{subject}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label
              htmlFor={fieldId}
              className="block text-sm font-medium text-foreground"
            >
              {t("reopenReasonLabel")}
            </label>
            <textarea
              ref={fieldRef}
              id={fieldId}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(false);
              }}
              rows={3}
              maxLength={MAX_REASON}
              required
              aria-invalid={error || undefined}
              aria-describedby={error ? errorId : undefined}
              className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            {error && (
              <p id={errorId} role="alert" className="text-sm text-danger">
                {t("reopenReasonRequired", { min: MIN_REASON })}
              </p>
            )}
          </div>
          {failure && (
            <p role="alert" className="text-sm text-danger">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {t("reopenCancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={submitting}>
              {t("reopenConfirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
