"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "@librehr/ui";
import type { PasswordResetRequest } from "@librehr/contracts";
import { getApiClient } from "@/lib/api-client";
import { AuthNotice, AuthPanel } from "@/features/auth/auth-panel";

type Locale = NonNullable<PasswordResetRequest["locale"]>;
const isLocale = (value: string): value is Locale =>
  value === "ca" || value === "es" || value === "en";

/** AUTH-001: asks for a reset link. The answer never says whether the account exists. */
export default function ForgotPasswordPage() {
  const params = useParams();
  const rawLocale = (params?.["locale"] as string | undefined) ?? "ca";
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "ca";
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");

  const [email, setEmail] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);
    try {
      await getApiClient().requestPasswordReset({ email, locale });
      setSent(true);
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err !== null && "status" in err
          ? err.status
          : undefined;
      setErrorMessage(
        status === 429 ? tAuth("tooManyRequests") : tAuth("genericError"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthPanel
      title={tAuth("forgotTitle")}
      description={sent ? undefined : tAuth("forgotDescription")}
    >
      {sent ? (
        <AuthNotice tone="success">{tAuth("forgotSent")}</AuthNotice>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          {errorMessage && <AuthNotice tone="error">{errorMessage}</AuthNotice>}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground"
            >
              {tAuth("emailLabel")}{" "}
              <span className="text-xs text-muted-foreground">
                {tCommon("required")}
              </span>
            </label>
            <div className="mt-1">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={tAuth("emailPlaceholder")}
              />
            </div>
          </div>
          <Button type="submit" className="w-full" isLoading={isLoading}>
            {tAuth("forgotSubmit")}
          </Button>
        </form>
      )}
      <p className="text-sm">
        <Link
          href={`/${locale}/sign-in`}
          className="font-medium text-primary hover:underline"
        >
          {tAuth("backToSignIn")}
        </Link>
      </p>
    </AuthPanel>
  );
}
