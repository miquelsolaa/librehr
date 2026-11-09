"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Copy,
  Check,
  ArrowLeft,
} from "lucide-react";
import { Button, Input } from "@librehr/ui";
import { getApiClient } from "@/lib/api-client";
import { getStoredSession } from "@/lib/auth";

export default function SecuritySettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  const [session, setSession] = React.useState(getStoredSession());
  const [twoFactorEnabled, setTwoFactorEnabled] = React.useState(false);
  const [requireTwoFactor, setRequireTwoFactor] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );

  // Setup Modal State
  const [isSetupOpen, setIsSetupOpen] = React.useState(false);
  const [setupData, setSetupData] = React.useState<{
    secret: string;
    qrUri: string;
    recoveryCodes: string[];
  } | null>(null);
  const [verificationCode, setVerificationCode] = React.useState("");
  const [copiedCodes, setCopiedCodes] = React.useState(false);

  const isAdmin = session?.role === "admin";

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const client = getApiClient();
      const me = await client.getMe();
      setTwoFactorEnabled(me.user.twoFactorEnabled ?? false);

      if (me.organization.requireTwoFactor !== undefined) {
        setRequireTwoFactor(me.organization.requireTwoFactor);
      }
    } catch {
      setErrorMessage(t("loadError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    setSession(getStoredSession());
    loadData();
  }, [loadData]);

  const handleStartSetup = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const client = getApiClient();
      const data = await client.setupTwoFactor();
      setSetupData(data);
      setIsSetupOpen(true);
      setVerificationCode("");
    } catch {
      setErrorMessage(t("twoFactorSetupError"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupData) return;

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const client = getApiClient();
      await client.enableTwoFactor({
        secret: setupData.secret,
        code: verificationCode.trim(),
        recoveryCodes: setupData.recoveryCodes,
      });

      setTwoFactorEnabled(true);
      setIsSetupOpen(false);
      setSuccessMessage(t("twoFactorEnabledSuccess"));
    } catch {
      setErrorMessage(t("invalid2FaCode"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisable = async () => {
    if (!window.confirm(t("disable2FaConfirm"))) return;

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const client = getApiClient();
      await client.disableTwoFactor();
      setTwoFactorEnabled(false);
      setSuccessMessage(t("twoFactorDisabledSuccess"));
    } catch {
      setErrorMessage(t("twoFactorDisableError"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleOrgRequirement = async () => {
    const nextVal = !requireTwoFactor;
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const client = getApiClient();
      await client.updateSecuritySettings({ requireTwoFactor: nextVal });
      setRequireTwoFactor(nextVal);
      setSuccessMessage(t("orgPolicyUpdatedSuccess"));
    } catch {
      setErrorMessage(t("orgPolicyUpdateError"));
    } finally {
      setActionLoading(false);
    }
  };

  const copyRecoveryCodes = () => {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.recoveryCodes.join("\n"));
    setCopiedCodes(true);
    setTimeout(() => setCopiedCodes(false), 2000);
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
            {t("securityTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("securityDescription")}
          </p>
        </div>
      </div>

      {successMessage && (
        <div
          role="status"
          className="rounded-card border border-success/30 bg-success/10 p-4 text-sm text-success"
        >
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-card border border-danger/30 bg-danger/10 p-4 text-sm text-danger"
        >
          {errorMessage}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Personal 2FA Card */}
        <div className="rounded-card border border-border bg-surface p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-primary/10">
                <KeyRound className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {t("twoFactorUserTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("twoFactorUserSubtitle")}
                </p>
              </div>
            </div>
            {twoFactorEnabled ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t("enabled")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/20 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t("disabled")}
              </span>
            )}
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("twoFactorExplanation")}
          </p>

          <div className="pt-2">
            {twoFactorEnabled ? (
              <Button
                variant="outline"
                className="text-danger border-danger/30 hover:bg-danger/10"
                onClick={handleDisable}
                isLoading={actionLoading}
              >
                {t("disableTwoFactor")}
              </Button>
            ) : (
              <Button
                onClick={handleStartSetup}
                isLoading={actionLoading || isLoading}
              >
                {t("setupTwoFactor")}
              </Button>
            )}
          </div>
        </div>

        {/* Organization Security Policy Card */}
        {isAdmin && (
          <div className="rounded-card border border-border bg-surface p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-primary/10">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {t("orgPolicyTitle")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("orgPolicySubtitle")}
                </p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("orgPolicyExplanation")}
            </p>

            <div className="flex items-center justify-between rounded-input border border-border bg-background p-4">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {t("requireTwoFactorAll")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("requireTwoFactorHint")}
                </div>
              </div>
              <input
                type="checkbox"
                checked={requireTwoFactor}
                onChange={handleToggleOrgRequirement}
                disabled={actionLoading || isLoading}
                className="h-5 w-5 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* Setup 2FA Modal */}
      {isSetupOpen && setupData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-card border border-border bg-background p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div>
              <h2 className="text-lg font-bold text-foreground">
                {t("setupTwoFactorModalTitle")}
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {t("setupTwoFactorModalSubtitle")}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                  1. {t("scanQrCodeStep")}
                </div>
                <div className="rounded-input border border-border bg-surface p-3 font-mono text-xs break-all select-all">
                  {setupData.qrUri}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("secretKeyLabel")}:{" "}
                  <code className="font-mono font-bold text-foreground">
                    {setupData.secret}
                  </code>
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    2. {t("backupCodesStep")}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copyRecoveryCodes}
                    className="h-7 text-xs flex items-center gap-1"
                  >
                    {copiedCodes ? (
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
                <div className="grid grid-cols-2 gap-2 rounded-input border border-border bg-surface p-3 font-mono text-xs text-center">
                  {setupData.recoveryCodes.map((code) => (
                    <span key={code} className="p-1 rounded bg-background">
                      {code}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("backupCodesNotice")}
                </p>
              </div>

              <form onSubmit={handleConfirmEnable} className="space-y-3">
                <div className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  3. {t("verifyCodeStep")}
                </div>
                <Input
                  id="verificationCode"
                  name="verificationCode"
                  type="text"
                  required
                  autoFocus
                  placeholder="123456"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value)}
                  className="text-center font-mono text-xl tracking-widest"
                />

                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsSetupOpen(false)}
                    disabled={actionLoading}
                  >
                    {tCommon("cancel")}
                  </Button>
                  <Button type="submit" isLoading={actionLoading}>
                    {t("enableTwoFactorButton")}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
