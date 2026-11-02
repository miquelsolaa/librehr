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

  const [email, setEmail] = React.useState("admin@librehr.test");
  const [password, setPassword] = React.useState("AdminSecret2026!");
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const client = getApiClient();
      const res = await client.signIn({ email, password });

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
      setErrorMessage(tAuth("invalidCredentials"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-card border border-border bg-background p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-xl font-bold text-primary-foreground">
            OH
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
            {tAuth("signInTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {tAuth("signInDescription")}
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
        </form>
      </div>
    </div>
  );
}
