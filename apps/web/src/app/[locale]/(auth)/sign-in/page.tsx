"use client";

import * as React from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Input } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { setStoredSession } from "@/lib/auth";

export default function SignInPage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");

  const [email, setEmail] = React.useState("admin@librehr.local");
  const [password, setPassword] = React.useState("Password123!");
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // 2FA Challenge State
  const [challengeToken, setChallengeToken] = React.useState<string | null>(
    null,
  );
  const [twoFactorCode, setTwoFactorCode] = React.useState("");

  // SSO Flow State
  const [showSsoPrompt, setShowSsoPrompt] = React.useState(false);
  const [ssoDomain, setSsoDomain] = React.useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const client = getApiClient();
      const res = await client.signIn({ email, password });

      if ("requiresTwoFactor" in res && res.requiresTwoFactor) {
        setChallengeToken(res.challengeToken);
        setIsLoading(false);
        return;
      }

      if ("user" in res) {
        setStoredSession({
          userId: res.user.id,
          email: res.user.email,
          name: res.user.name,
          organizationId: res.user.organizationId,
          role: res.user.role,
          token: "librehr_session_token",
        });

        router.push(`/${locale}/home`);
      }
    } catch {
      setErrorMessage(tAuth("invalidCredentials"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2Fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeToken) return;

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const client = getApiClient();
      const res = await client.verifyTwoFactor({
        challengeToken,
        code: twoFactorCode,
      });

      setStoredSession({
        userId: res.user.id,
        email: res.user.email,
        name: res.user.name,
        organizationId: res.user.organizationId,
        role: res.user.role,
        token: "librehr_session_token",
      });

      router.push(`/${locale}/home`);
    } catch {
      setErrorMessage(tAuth("invalid2FaCode"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSsoAuthorize = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const client = getApiClient();
      const res = await client.authorizeSso({
        domain: ssoDomain.trim() || undefined,
        email: email.trim() || undefined,
      });

      window.location.href = res.authorizationUrl;
    } catch {
      setErrorMessage(tAuth("ssoNotFound"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-card border border-border bg-background p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-xl font-bold text-primary-foreground">
            LH
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
            {challengeToken ? tAuth("twoFactorTitle") : tAuth("signInTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {challengeToken
              ? tAuth("twoFactorDescription")
              : tAuth("signInDescription")}
          </p>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="rounded-input border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
          >
            {errorMessage}
          </div>
        )}

        {/* 2FA Verification Form */}
        {challengeToken ? (
          <form className="mt-6 space-y-4" onSubmit={handleVerify2Fa}>
            <div>
              <label
                htmlFor="twoFactorCode"
                className="block text-sm font-medium text-foreground"
              >
                {tAuth("twoFactorCodeLabel")}{" "}
                <span className="text-xs text-muted-foreground">
                  {tCommon("required")}
                </span>
              </label>
              <div className="mt-1">
                <Input
                  id="twoFactorCode"
                  name="twoFactorCode"
                  type="text"
                  autoComplete="one-time-code"
                  required
                  autoFocus
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  placeholder="123456"
                  className="text-center text-xl font-mono tracking-widest"
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {tAuth("twoFactorBackupHint")}
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button type="submit" className="w-full" isLoading={isLoading}>
                {tAuth("verifyCodeButton")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setChallengeToken(null);
                  setTwoFactorCode("");
                }}
              >
                {tCommon("back")}
              </Button>
            </div>
          </form>
        ) : showSsoPrompt ? (
          /* SSO Discovery Form */
          <form className="mt-6 space-y-4" onSubmit={handleSsoAuthorize}>
            <div>
              <label
                htmlFor="ssoDomain"
                className="block text-sm font-medium text-foreground"
              >
                {tAuth("ssoDomainLabel")}{" "}
                <span className="text-xs text-muted-foreground">
                  {tCommon("required")}
                </span>
              </label>
              <div className="mt-1">
                <Input
                  id="ssoDomain"
                  name="ssoDomain"
                  type="text"
                  required
                  autoFocus
                  value={ssoDomain}
                  onChange={(e) => setSsoDomain(e.target.value)}
                  placeholder="company.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <Button type="submit" className="w-full" isLoading={isLoading}>
                {tAuth("ssoContinueButton")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setShowSsoPrompt(false)}
              >
                {tCommon("back")}
              </Button>
            </div>
          </form>
        ) : (
          /* Standard Email + Password Form */
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
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

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground"
              >
                {tAuth("passwordLabel")}{" "}
                <span className="text-xs text-muted-foreground">
                  {tCommon("required")}
                </span>
              </label>
              <div className="mt-1">
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tAuth("passwordPlaceholder")}
                />
              </div>
            </div>

            <div className="pt-2">
              <Button type="submit" className="w-full" isLoading={isLoading}>
                {tAuth("signInButton")}
              </Button>
            </div>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  {tCommon("or")}
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setShowSsoPrompt(true)}
            >
              {tAuth("signInWithSso")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
