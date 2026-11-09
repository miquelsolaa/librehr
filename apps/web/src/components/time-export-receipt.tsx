"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@librehr/ui";
import { Check, Copy, ShieldCheck } from "lucide-react";

export interface TimeExportReceiptProps {
  exportId: string;
  contentHash: string;
}

/**
 * TIM-006: the export id and SHA-256 of an export, so whoever hands the file
 * over can later match it against the audit log. Neither value is secret.
 */
export function TimeExportReceipt({
  exportId,
  contentHash,
}: TimeExportReceiptProps) {
  const t = useTranslations("timeTracking");
  return (
    <section
      aria-labelledby="export-receipt-title"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck
          className="mt-0.5 h-5 w-5 shrink-0 text-success"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <h2
            id="export-receipt-title"
            className="text-sm font-semibold text-foreground"
          >
            {t("exportVerificationTitle")}
          </h2>
          <ReceiptValue
            id="export-receipt-id"
            label={t("exportIdLabel")}
            value={exportId}
          />
          <ReceiptValue
            id="export-receipt-hash"
            label={t("contentHash")}
            value={contentHash}
          />
          <p className="text-xs text-muted-foreground">
            {t("exportReceiptHelp")}
          </p>
        </div>
      </div>
    </section>
  );
}

function ReceiptValue({
  id,
  label,
  value,
}: {
  id: string;
  label: string;
  value: string;
}) {
  const t = useTranslations("timeTracking");
  const tCommon = useTranslations("common");
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard unavailable (permissions or insecure context): the value
      // stays selectable on screen.
    }
  };

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2 rounded-input border border-border bg-background px-3 py-1.5">
        <code
          data-testid={id}
          className="min-w-0 flex-1 select-all break-all font-mono text-xs text-foreground"
        >
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void copy()}
          aria-label={t("exportCopyValue", { label })}
          className="h-8 w-8 shrink-0 p-0"
        >
          {copied ? (
            <Check className="h-4 w-4 text-success" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied ? tCommon("copied") : ""}
        </span>
      </div>
    </div>
  );
}
