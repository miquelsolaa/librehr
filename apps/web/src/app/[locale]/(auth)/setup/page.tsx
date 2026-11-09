"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Check, ArrowRight, ArrowLeft } from "lucide-react";
import { Button, Input } from "@librehr/ui";
import { apiClient } from "../../../../lib/api-client.js";

export default function SetupWizardPage() {
  const params = useParams();
  const router = useRouter();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("setup");
  const tCommon = useTranslations("common");
  const tRegions = useTranslations("regions");

  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [alreadyCompleted, setAlreadyCompleted] = React.useState(false);
  const completedHeading = React.useRef<HTMLHeadingElement>(null);

  // The submit button disappears with the form; keep keyboard and screen
  // reader users on the message that replaced it.
  React.useEffect(() => {
    if (alreadyCompleted) completedHeading.current?.focus();
  }, [alreadyCompleted]);

  // Form State
  const [formData, setFormData] = React.useState({
    // Nothing is pre-filled: sample values would be submitted unnoticed, and
    // the password must be typed by the administrator.
    orgName: "",
    orgSlug: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
    defaultLocale: (locale as "ca" | "es" | "en") || "ca",
    timezone: "Europe/Madrid",
    legalEntityName: "",
    legalEntityCif: "",
    locationName: "",
    locationCity: "",
    locationRegion: "CT",
  });

  const updateField = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      // Auto-generate slug from name if modifying orgName and slug wasn't manually edited
      if (
        field === "orgName" &&
        (!prev.orgSlug ||
          prev.orgSlug ===
            prev.orgName.toLowerCase().replace(/[^a-z0-9]/g, "-"))
      ) {
        next.orgSlug = value
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
      }
      return next;
    });
  };

  const handleNextStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !formData.orgName ||
      !formData.orgSlug ||
      !formData.adminEmail ||
      !formData.adminPassword
    ) {
      setError(t("requiredStep1"));
      return;
    }
    setError("");
    setStep(2);
  };

  const handleNextStep2 = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !formData.legalEntityName ||
      !formData.legalEntityCif ||
      !formData.locationName ||
      !formData.locationCity
    ) {
      setError(t("requiredStep2"));
      return;
    }
    setError("");
    setStep(3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await apiClient.runSetupWizard({
        orgName: formData.orgName,
        orgSlug: formData.orgSlug,
        adminName: formData.adminName,
        adminEmail: formData.adminEmail,
        adminPassword: formData.adminPassword,
        defaultLocale: formData.defaultLocale,
        timezone: formData.timezone,
        legalEntityName: formData.legalEntityName,
        legalEntityCif: formData.legalEntityCif,
        locationName: formData.locationName,
        locationCity: formData.locationCity,
        locationRegion: formData.locationRegion,
      });

      router.push(`/${locale}/sign-in`);
    } catch (err) {
      // The API refuses setup once an organization exists (409).
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code === "SETUP_ALREADY_COMPLETED"
      ) {
        setAlreadyCompleted(true);
        setFormData((prev) => ({ ...prev, adminPassword: "" }));
        return;
      }
      setError(t("setupFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-8 py-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-btn bg-primary/10 text-primary">
          <Building2 className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h1>
        {!alreadyCompleted && (
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        )}
      </div>

      {alreadyCompleted && (
        <section
          aria-labelledby="setup-completed-title"
          className="space-y-4 rounded-card border border-border bg-surface p-6 text-center"
        >
          <h2
            ref={completedHeading}
            tabIndex={-1}
            id="setup-completed-title"
            className="text-lg font-semibold text-foreground"
          >
            {t("alreadyCompletedTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("alreadyCompletedDescription")}
          </p>
          <Button asChild>
            <Link href={`/${locale}/sign-in`}>{t("goToSignIn")}</Link>
          </Button>
        </section>
      )}

      {/* Steps Indicator */}
      {!alreadyCompleted && (
        <div className="flex items-center justify-between border-b border-border pb-4 text-xs font-medium">
          <span
            className={
              step >= 1 ? "text-primary font-semibold" : "text-muted-foreground"
            }
          >
            {t("step1")}
          </span>
          <span
            className={
              step >= 2 ? "text-primary font-semibold" : "text-muted-foreground"
            }
          >
            {t("step2")}
          </span>
          <span
            className={
              step === 3
                ? "text-primary font-semibold"
                : "text-muted-foreground"
            }
          >
            {t("step3")}
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-card bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Step 1: Org & Admin */}
      {!alreadyCompleted && step === 1 && (
        <form onSubmit={handleNextStep1} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="org-name"
              className="text-xs font-medium text-foreground"
            >
              {t("orgName")}
            </label>
            <Input
              id="org-name"
              required
              placeholder={t("orgNamePlaceholder")}
              value={formData.orgName}
              onChange={(e) => updateField("orgName", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="org-slug"
              className="text-xs font-medium text-foreground"
            >
              {t("orgSlug")}
            </label>
            <Input
              id="org-slug"
              required
              placeholder="acme-iberia"
              value={formData.orgSlug}
              onChange={(e) => updateField("orgSlug", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="admin-name"
              className="text-xs font-medium text-foreground"
            >
              {t("adminName")}
            </label>
            <Input
              id="admin-name"
              required
              placeholder="Marta Soler"
              value={formData.adminName}
              onChange={(e) => updateField("adminName", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="admin-email"
              className="text-xs font-medium text-foreground"
            >
              {t("adminEmail")}
            </label>
            <Input
              id="admin-email"
              type="email"
              required
              placeholder="admin@acme.test"
              value={formData.adminEmail}
              onChange={(e) => updateField("adminEmail", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="admin-pass"
              className="text-xs font-medium text-foreground"
            >
              {t("adminPassword")}
            </label>
            <Input
              id="admin-pass"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              aria-describedby="admin-pass-hint"
              value={formData.adminPassword}
              onChange={(e) => updateField("adminPassword", e.target.value)}
            />
            <p id="admin-pass-hint" className="text-xs text-muted-foreground">
              {t("adminPasswordHint")}
            </p>
          </div>

          <div className="pt-4 flex justify-end">
            <Button type="submit" className="gap-2">
              <span>{t("next")}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>
      )}

      {/* Step 2: Legal Entity & Location */}
      {!alreadyCompleted && step === 2 && (
        <form onSubmit={handleNextStep2} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="legal-name"
              className="text-xs font-medium text-foreground"
            >
              {t("legalEntityName")}
            </label>
            <Input
              id="legal-name"
              required
              placeholder={t("legalEntityNamePlaceholder")}
              value={formData.legalEntityName}
              onChange={(e) => updateField("legalEntityName", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="legal-cif"
              className="text-xs font-medium text-foreground"
            >
              {t("legalEntityCif")}
            </label>
            <Input
              id="legal-cif"
              required
              placeholder="B12345678"
              value={formData.legalEntityCif}
              onChange={(e) => updateField("legalEntityCif", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="loc-name"
              className="text-xs font-medium text-foreground"
            >
              {t("locationName")}
            </label>
            <Input
              id="loc-name"
              required
              placeholder={t("locationNamePlaceholder")}
              value={formData.locationName}
              onChange={(e) => updateField("locationName", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="loc-city"
                className="text-xs font-medium text-foreground"
              >
                {t("locationCity")}
              </label>
              <Input
                id="loc-city"
                required
                placeholder="Barcelona"
                value={formData.locationCity}
                onChange={(e) => updateField("locationCity", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="loc-region"
                className="text-xs font-medium text-foreground"
              >
                {t("locationRegion")}
              </label>
              <select
                id="loc-region"
                className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                value={formData.locationRegion}
                onChange={(e) => updateField("locationRegion", e.target.value)}
              >
                {["CT", "MD", "AN", "VC", "PV"].map((code) => (
                  <option key={code} value={code}>
                    {tRegions(code)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-4 flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(1)}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{tCommon("back")}</span>
            </Button>
            <Button type="submit" className="gap-2">
              <span>{t("next")}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>
      )}

      {/* Step 3: Review and Launch */}
      {!alreadyCompleted && step === 3 && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-card border border-border bg-surface p-6 space-y-3 text-sm">
            <h3 className="font-semibold text-foreground border-b border-border pb-2">
              {t("summaryTitle")}
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-muted-foreground">{t("orgName")}:</span>
              <span className="font-medium text-foreground">
                {formData.orgName}
              </span>

              <span className="text-muted-foreground">{t("orgSlug")}:</span>
              <span className="font-mono text-foreground">
                {formData.orgSlug}
              </span>

              <span className="text-muted-foreground">{t("adminEmail")}:</span>
              <span className="text-foreground">{formData.adminEmail}</span>

              <span className="text-muted-foreground">
                {t("legalEntityName")}:
              </span>
              <span className="text-foreground">
                {formData.legalEntityName} ({formData.legalEntityCif})
              </span>

              <span className="text-muted-foreground">
                {t("locationName")}:
              </span>
              <span className="text-foreground">
                {formData.locationName} ({formData.locationCity},{" "}
                {tRegions(formData.locationRegion)})
              </span>
            </div>
          </div>

          <div className="pt-4 flex justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep(2)}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>{tCommon("back")}</span>
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              <Check className="h-4 w-4" />
              <span>{submitting ? tCommon("loading") : t("submit")}</span>
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
