"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { AuthNotice, AuthPanel } from "@/features/auth/auth-panel";

type State = "loading" | "form" | "invalid" | "done";

/**
 * AUTH-001: confirms an email address from an emailed link. The token arrives
 * in the URL fragment (never sent to a server) and is removed from the address
 * bar as soon as it is read. Confirming needs a click, not just a visit, so a
 * mail scanner that opens the link does not spend it. Confirming asks for the
 * account password, so whoever receives a link sent to a mistyped address
 * cannot confirm it. It needs no session and does not open one, so the link
 * also works on another device.
 */
export default function VerifyEmailPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const t = useTranslations("auth.verifyEmail");
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");

  const [token, setToken] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
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
    if (!token || !password) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      await getApiClient().confirmEmailVerification({ token, password });
      setState("done");
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err !== null
          ? (err as { status?: unknown }).status
          : undefined;
      // 400 is either VERIFICATION_TOKEN_INVALID or a malformed token: to the
      // user both are just a link that no longer works.
      if (status === 400) setState("invalid");
      // A wrong password spends nothing: the same link can be tried again.
      else if (status === 401) setErrorMessage(t("wrongPassword"));
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
        <div>
          <label
            htmlFor="account-password"
            className="block text-sm font-medium text-foreground"
          >
            {t("passwordLabel")}{" "}
            <span className="text-xs text-muted-foreground">
              {tCommon("required")}
            </span>
          </label>
          <div className="mt-1">
            <Input
              id="account-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <Button type="submit" className="w-full" isLoading={isLoading}>
          {t("submit")}
        </Button>
      </form>
    </AuthPanel>
  );
}
