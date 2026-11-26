"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { MailWarning } from "lucide-react";
import { Button } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";

type Feedback = "sent" | "unavailable" | "tooMany" | "error";

/**
 * AUTH-001 soft gate: an unverified account keeps full access but sees this
 * banner until the address is confirmed. Reset links only go to confirmed
 * addresses, so the banner says why it matters.
 */
export function EmailVerificationBanner() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const t = useTranslations("auth.verifyEmail");
  const tAuth = useTranslations("auth");

  const [unverified, setUnverified] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [feedback, setFeedback] = React.useState<Feedback | null>(null);

  React.useEffect(() => {
    let active = true;
    void getApiClient()
      .getMe()
      .then((me) => {
        // Only an explicit false shows the banner; older APIs omit the field.
        if (active) setUnverified(me.emailVerified === false);
      })
      .catch(() => {
        // Not signed in or offline: the page itself handles that.
      });
    return () => {
      active = false;
    };
  }, []);

  if (!unverified) return null;

  const resend = async () => {
    setIsSending(true);
    setFeedback(null);
    try {
      await getApiClient().requestEmailVerification({
        locale: locale === "es" || locale === "en" ? locale : "ca",
      });
      setFeedback("sent");
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err !== null
          ? (err as { status?: unknown }).status
          : undefined;
      if (status === 503) setFeedback("unavailable");
      else if (status === 429) setFeedback("tooMany");
      else setFeedback("error");
    } finally {
      setIsSending(false);
    }
  };

  const feedbackText =
    feedback === "sent"
      ? t("bannerSent")
      : feedback === "unavailable"
        ? t("bannerUnavailable")
        : feedback === "tooMany"
          ? tAuth("tooManyRequests")
          : feedback === "error"
            ? tAuth("genericError")
            : "";

  return (
    <section
      aria-labelledby="email-verification-banner-title"
      className="mb-6 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-foreground sm:flex-row sm:items-start"
    >
      <MailWarning
        aria-hidden="true"
        className="h-5 w-5 shrink-0 text-foreground"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <h2 id="email-verification-banner-title" className="font-semibold">
          {t("bannerTitle")}
        </h2>
        <p>{t("bannerText")}</p>
        {/* Always rendered so screen readers announce the change. */}
        <p role="status" className="font-medium">
          {feedbackText}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 self-start"
        isLoading={isSending}
        disabled={feedback === "sent"}
        onClick={() => void resend()}
      >
        {t("bannerResend")}
      </Button>
    </section>
  );
}
