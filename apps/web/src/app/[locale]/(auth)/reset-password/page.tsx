"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { AuthNotice, AuthPanel } from "@/features/auth/auth-panel";

const MIN_PASSWORD_LENGTH = 8;

type State = "loading" | "form" | "invalid" | "done";

/**
 * AUTH-001: sets a new password from an emailed link. The token arrives in
 * the URL fragment (never sent to a server) and is removed from the address
 * bar as soon as it is read.
 */
export default function ResetPasswordPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");

  const [token, setToken] = React.useState<string | null>(null);
  const [state, setState] = React.useState<State>("loading");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
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
    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(tAuth("passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setErrorMessage(tAuth("passwordsDoNotMatch"));
      return;
    }
    setIsLoading(true);
    try {
      await getApiClient().confirmPasswordReset({ token, password });
      setState("done");
    } catch (err: unknown) {
      const problem =
        typeof err === "object" && err !== null
          ? (err as { status?: unknown; code?: unknown; errors?: unknown })
          : {};
      // A malformed token fails validation on the "token" field: to the
      // user that is just an invalid link, not a password problem.
      const tokenRejected =
        Array.isArray(problem.errors) &&
        problem.errors.some(
          (issue: unknown) =>
            typeof issue === "object" &&
            issue !== null &&
            (issue as { field?: unknown }).field === "token",
        );
      if (problem.code === "RESET_TOKEN_INVALID" || tokenRejected)
        setState("invalid");
      else if (problem.status === 429)
        setErrorMessage(tAuth("tooManyRequests"));
      else if (problem.status === 400)
        setErrorMessage(tAuth("passwordTooShort"));
      else setErrorMessage(tAuth("genericError"));
    } finally {
      setIsLoading(false);
    }
  };

  const linkClass = "font-medium text-primary hover:underline";

  if (state === "loading") {
    return (
      <AuthPanel title={tAuth("resetTitle")}>
        <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>
      </AuthPanel>
    );
  }

  if (state === "invalid") {
    return (
      <AuthPanel title={tAuth("resetTitle")}>
        <AuthNotice tone="error">{tAuth("resetInvalidLink")}</AuthNotice>
        <p className="text-sm">
          <Link href={`/${locale}/forgot-password`} className={linkClass}>
            {tAuth("requestNewLink")}
          </Link>
        </p>
      </AuthPanel>
    );
  }

  if (state === "done") {
    return (
      <AuthPanel title={tAuth("resetTitle")}>
        <AuthNotice tone="success">{tAuth("resetDone")}</AuthNotice>
        <p className="text-sm">
          <Link href={`/${locale}/sign-in`} className={linkClass}>
            {tAuth("backToSignIn")}
          </Link>
        </p>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel
      title={tAuth("resetTitle")}
      description={tAuth("resetDescription")}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        {errorMessage && <AuthNotice tone="error">{errorMessage}</AuthNotice>}
        <div>
          <label
            htmlFor="new-password"
            className="block text-sm font-medium text-foreground"
          >
            {tAuth("newPasswordLabel")}{" "}
            <span className="text-xs text-muted-foreground">
              {tCommon("required")}
            </span>
          </label>
          <div className="mt-1">
            <Input
              id="new-password"
              name="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              aria-describedby="new-password-hint"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <p
            id="new-password-hint"
            className="mt-1 text-xs text-muted-foreground"
          >
            {tAuth("passwordHint")}
          </p>
        </div>
        <div>
          <label
            htmlFor="confirm-password"
            className="block text-sm font-medium text-foreground"
          >
            {tAuth("confirmPasswordLabel")}{" "}
            <span className="text-xs text-muted-foreground">
              {tCommon("required")}
            </span>
          </label>
          <div className="mt-1">
            <Input
              id="confirm-password"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <Button type="submit" className="w-full" isLoading={isLoading}>
          {tAuth("resetSubmit")}
        </Button>
      </form>
      <p className="text-sm">
        <Link href={`/${locale}/sign-in`} className={linkClass}>
          {tAuth("backToSignIn")}
        </Link>
      </p>
    </AuthPanel>
  );
}
