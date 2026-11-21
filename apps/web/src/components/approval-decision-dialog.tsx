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

/** Shortest required comment, matching the correction reason rule. */
const MIN_REQUIRED_COMMENT = 5;
/** Longest comment; a note to a person, not a document. */
const MAX_COMMENT = 1000;

export type Decision = "approve" | "reject";

export interface ApprovalDecisionDialogProps {
  open: boolean;
  decision: Decision;
  title: string;
  /** Who and what is being decided. */
  subject: string;
  submitting: boolean;
  /** Why the last attempt failed, shown inside the dialog so it is seen. */
  failure?: string | undefined;
  onOpenChange: (open: boolean) => void;
  onConfirm: (comment: string | undefined) => void;
  /**
   * LEA-004 sole-approver exception: the caller approves their own request,
   * which the API only accepts with a reason.
   */
  selfApproval?: boolean | undefined;
  /**
   * Where focus goes when the dialog closes. Without it, focus returns to the
   * button that opened it, which is gone once the request is decided.
   */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * LEA-004 / TIM-003: confirms a decision. The comment is optional when
 * approving and required when rejecting, so the employee learns why. It is
 * also required when approving your own request as its sole approver.
 */
export function ApprovalDecisionDialog({
  open,
  decision,
  title,
  subject,
  submitting,
  failure,
  onOpenChange,
  onConfirm,
  selfApproval = false,
  onCloseAutoFocus,
}: ApprovalDecisionDialogProps) {
  const t = useTranslations("approvals");
  const [comment, setComment] = React.useState("");
  const [error, setError] = React.useState(false);
  const fieldRef = React.useRef<HTMLTextAreaElement>(null);
  const fieldId = React.useId();
  const errorId = React.useId();
  const reject = decision === "reject";
  const required = reject || selfApproval;

  React.useEffect(() => {
    if (open) {
      setComment("");
      setError(false);
    }
  }, [open]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = comment.trim();
    if (required && trimmed.length < MIN_REQUIRED_COMMENT) {
      setError(true);
      fieldRef.current?.focus();
      return;
    }
    onConfirm(trimmed === "" ? undefined : trimmed);
  };

  return (
    <Dialog
      open={open}
      // A decision in flight finishes before the dialog can close, so its
      // outcome is always shown where it was asked for.
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{subject}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label
              htmlFor={fieldId}
              className="block text-sm font-medium text-foreground"
            >
              {reject
                ? t("rejectComment")
                : selfApproval
                  ? t("selfApproveComment")
                  : t("approveComment")}
            </label>
            <textarea
              ref={fieldRef}
              id={fieldId}
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                if (error) setError(false);
              }}
              rows={3}
              maxLength={MAX_COMMENT}
              required={required}
              aria-invalid={error || undefined}
              aria-describedby={error ? errorId : undefined}
              className="w-full rounded-md border border-border bg-background p-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            {error && (
              <p id={errorId} role="alert" className="text-sm text-danger">
                {t("rejectCommentRequired", { min: MIN_REQUIRED_COMMENT })}
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
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant={reject ? "danger" : "default"}
              disabled={submitting}
            >
              {reject ? t("confirmReject") : t("confirmApprove")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
