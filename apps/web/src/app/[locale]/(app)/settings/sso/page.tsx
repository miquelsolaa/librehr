"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Globe,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  ArrowLeft,
} from "lucide-react";
import { Button, Input } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import type { SsoConfig, SsoProvider } from "@librehr/contracts";

export default function SsoSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  const [config, setConfig] = React.useState<SsoConfig | null>(null);
  const [provider, setProvider] = React.useState<SsoProvider>("google");
  const [clientId, setClientId] = React.useState("");
  const [clientSecret, setClientSecret] = React.useState("");
  const [issuerUrl, setIssuerUrl] = React.useState(
    "https://accounts.google.com",
  );
  const [allowedDomains, setAllowedDomains] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [enforceSso, setEnforceSso] = React.useState(false);

  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [copiedCallback, setCopiedCallback] = React.useState(false);

  const callbackUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/v1/sso/callback`
      : "https://your-domain.com/api/v1/sso/callback";

  const loadConfig = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const client = getApiClient();
      const current = await client.getSsoConfig();
      if (current) {
        setConfig(current);
        setProvider(current.provider);
        setClientId(current.clientId);
        setIssuerUrl(current.issuerUrl);
        setAllowedDomains(current.allowedDomains.join(", "));
        setEnabled(current.enabled);
        setEnforceSso(current.enforceSso);
      }
    } catch {
      setErrorMessage(t("loadError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleProviderChange = (p: SsoProvider) => {
    setProvider(p);
    if (p === "google") {
      setIssuerUrl("https://accounts.google.com");
    } else if (p === "microsoft") {
      setIssuerUrl("https://login.microsoftonline.com/common/v2.0");
    } else if (!issuerUrl.startsWith("https://")) {
      setIssuerUrl("https://auth.company.com");
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const domains = allowedDomains
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (domains.length === 0) {
      setErrorMessage(t("ssoDomainsRequired"));
      setIsSaving(false);
      return;
    }

    try {
      const client = getApiClient();
      const saved = await client.saveSsoConfig({
        provider,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || "unchanged_existing_secret",
        issuerUrl: issuerUrl.trim(),
        allowedDomains: domains,
        enabled,
        enforceSso,
      });

      setConfig(saved);
      setSuccessMessage(t("ssoSavedSuccess"));
    } catch {
      setErrorMessage(t("ssoSaveError"));
    } finally {
      setIsSaving(false);
    }
  };

  const copyCallbackUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopiedCallback(true);
    setTimeout(() => setCopiedCallback(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/${locale}/settings`}
          className="rounded-btn p-2 text-muted-foreground hover:bg-surface hover:text-foreground transition-colors"
          aria-label={t("backToSettings")}
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("ssoTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("ssoDescription")}</p>
        </div>
      </div>

      {successMessage && (
        <div
          role="status"
          className="rounded-card border border-success/30 bg-success/10 p-4 text-sm text-success flex items-center gap-2"
        >
          <CheckCircle2 className="h-4 w-4" />
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger flex items-center gap-2"
        >
          <AlertCircle className="h-4 w-4" />
          {errorMessage}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <form
            onSubmit={handleSave}
            className="rounded-card border border-border bg-surface p-6 shadow-sm space-y-5"
          >
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t("ssoProviderLabel")}
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: "google", label: "Google Workspace" },
                  { id: "microsoft", label: "Microsoft Entra ID" },
                  { id: "generic_oidc", label: t("ssoGenericOidc") },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleProviderChange(item.id as SsoProvider)}
                    aria-pressed={provider === item.id}
                    className={`rounded-card border p-3 text-center text-sm font-medium transition-all cursor-pointer ${
                      provider === item.id
                        ? "border-primary bg-primary/10 text-primary font-bold shadow-xs"
                        : "border-border bg-background text-muted-foreground hover:bg-surface-raised"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="clientId"
                className="block text-sm font-medium text-foreground"
              >
                {t("ssoClientIdLabel")}{" "}
                <span className="text-xs text-muted-foreground">
                  {tCommon("required")}
                </span>
              </label>
              <Input
                id="clientId"
                name="clientId"
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="client-id-xyz.apps.googleusercontent.com"
                className="mt-1"
              />
            </div>

            <div>
              <label
                htmlFor="clientSecret"
                className="block text-sm font-medium text-foreground"
              >
                {t("ssoClientSecretLabel")}{" "}
                <span className="text-xs text-muted-foreground">
                  {config
                    ? t("ssoClientSecretLeaveBlank")
                    : tCommon("required")}
                </span>
              </label>
              <Input
                id="clientSecret"
                name="clientSecret"
                type="password"
                required={!config}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={config ? "••••••••••••••••" : "GOCSPX-..."}
                className="mt-1 font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="issuerUrl"
                className="block text-sm font-medium text-foreground"
              >
                {t("ssoIssuerUrlLabel")}{" "}
                <span className="text-xs text-muted-foreground">
                  {tCommon("required")}
                </span>
              </label>
              <Input
                id="issuerUrl"
                name="issuerUrl"
                required
                value={issuerUrl}
                onChange={(e) => setIssuerUrl(e.target.value)}
                placeholder="https://accounts.google.com"
                className="mt-1 font-mono text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="allowedDomains"
                className="block text-sm font-medium text-foreground"
              >
                {t("ssoAllowedDomainsLabel")}{" "}
                <span className="text-xs text-muted-foreground">
                  {tCommon("required")}
                </span>
              </label>
              <Input
                id="allowedDomains"
                name="allowedDomains"
                required
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                placeholder="acme.corp, acme.es"
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("ssoAllowedDomainsHint")}
              </p>
            </div>

            <div className="pt-2 border-t border-border space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div
                    id="sso-enabled-label"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("ssoEnabledLabel")}
                  </div>
                  <div
                    id="sso-enabled-hint"
                    className="text-xs text-muted-foreground"
                  >
                    {t("ssoEnabledHint")}
                  </div>
                </div>
                <input
                  type="checkbox"
                  aria-labelledby="sso-enabled-label"
                  aria-describedby="sso-enabled-hint"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-5 w-5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div
                    id="sso-enforce-label"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("ssoEnforceLabel")}
                  </div>
                  <div
                    id="sso-enforce-hint"
                    className="text-xs text-muted-foreground"
                  >
                    {t("ssoEnforceHint")}
                  </div>
                </div>
                <input
                  type="checkbox"
                  aria-labelledby="sso-enforce-label"
                  aria-describedby="sso-enforce-hint"
                  checked={enforceSso}
                  onChange={(e) => setEnforceSso(e.target.checked)}
                  className="h-5 w-5 rounded border-border text-primary focus:ring-primary cursor-pointer"
                />
              </div>
            </div>

            <div className="pt-2">
              <Button type="submit" isLoading={isSaving || isLoading}>
                {t("saveSsoButton")}
              </Button>
            </div>
          </form>
        </div>

        {/* Callback URI Info Card */}
        <div className="space-y-4">
          <div className="rounded-card border border-border bg-surface p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-primary/10">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {t("ssoRedirectUriTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("ssoRedirectUriSubtitle")}
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("ssoRedirectUriNotice")}
            </p>

            <div className="rounded-input border border-border bg-background p-3 flex items-center justify-between gap-2">
              <code className="text-xs font-mono break-all text-foreground select-all">
                {callbackUrl}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={copyCallbackUrl}
                className="h-8 shrink-0 text-xs flex items-center gap-1"
              >
                {copiedCallback ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-success" />
                    {tCommon("copied")}
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    {tCommon("copy")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
