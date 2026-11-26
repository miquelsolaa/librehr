"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { AuthNotice, AuthPanel } from "@/features/auth/auth-panel";

type State = "loading" | "form" | "invalid" | "done";

/**
 * AUTH-001: confirms an email address from an emailed link. The token arrives
 * in the URL fragment (never sent to a server) and is removed from the address
 * bar as soon as it is read. Confirming needs a click, not just a visit, so a
 * mail scanner that opens the link does not spend it. It needs no session and
 * does not open one, so the link also works on another device.
 */
export default function VerifyEmailPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const t = useTranslations("auth.verifyEmail");
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");

  const [token, setToken] = React.useState<string | null>(null);
  const [state, setState] = React.useState<State>("loading");
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const value = fragment.get("token");
    if (window.location.hash) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    setToken(value);
    setState(value ? "form" : "invalid");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      await getApiClient().confirmEmailVerification({ token });
      setState("done");
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err !== null
          ? (err as { status?: unknown }).status
          : undefined;
      // 400 is either VERIFICATION_TOKEN_INVALID or a malformed token: to the
      // user both are just a link that no longer works.
      if (status === 400) setState("invalid");
      else if (status === 429) setErrorMessage(tAuth("tooManyRequests"));
      else setErrorMessage(tAuth("genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  const linkClass = "font-medium text-primary hover:underline";

  if (state === "loading") {
    return (
      <AuthPanel title={t("title")}>
        <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
      </AuthPanel>
    );
  }

  if (state === "invalid") {
    return (
      <AuthPanel title={t("title")}>
        <AuthNotice tone="error">{t("invalidLink")}</AuthNotice>
        <p className="text-sm">
          <Link href={`/${locale}/home`} className={linkClass}>
            {t("continue")}
          </Link>
        </p>
      </AuthPanel>
    );
  }

  if (state === "done") {
    return (
      <AuthPanel title={t("title")}>
        <AuthNotice tone="success">{t("done")}</AuthNotice>
        <p className="text-sm">
          <Link href={`/${locale}/home`} className={linkClass}>
            {t("continue")}
          </Link>
        </p>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title={t("title")} description={t("description")}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        {errorMessage && <AuthNotice tone="error">{errorMessage}</AuthNotice>}
        <Button type="submit" className="w-full" isLoading={isLoading}>
          {t("submit")}
        </Button>
      </form>
    </AuthPanel>
  );
}
