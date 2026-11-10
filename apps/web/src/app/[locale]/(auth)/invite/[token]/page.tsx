"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Mail, Check, AlertCircle } from "lucide-react";
import { Button, Input } from "@librehr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import type { InvitationDetails } from "@librehr/contracts";

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const locale = (params?.["locale"] as string) ?? "es";
  const token = (params?.["token"] as string) ?? "";

  const t = useTranslations("invitations");
  const tCommon = useTranslations("common");

  const roleLabel = (role: string): string => {
    switch (role) {
      case "employee":
        return t("roleEmployee");
      case "manager":
        return t("roleManager");
      case "admin":
        return t("roleAdmin");
      default:
        return role;
    }
  };

  const [invite, setInvite] = React.useState<InvitationDetails | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiClient
      .getInvitation(token)
      .then((res) => setInvite(res))
      .catch(() => {
        setError(t("invalidToken"));
      })
      .finally(() => setLoading(false));
  }, [token, t]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await apiClient.acceptInvitation({
        token,
        name,
        password,
      });

      router.push(`/${locale}/home`);
    } catch {
      setError(t("acceptFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span className="text-sm text-muted-foreground">
          {tCommon("loading")}
        </span>
      </div>
    );
  }

  if (error && !invite) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-md rounded-card border border-danger/20 bg-danger/10 p-6 text-center space-y-3"
      >
        <AlertCircle
          className="mx-auto h-8 w-8 text-danger"
          aria-hidden="true"
        />
        <h1 className="text-base font-semibold text-danger">
          {t("errorTitle")}
        </h1>
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-input bg-primary/10 text-primary">
          <Mail className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("description", { orgName: invite?.orgName ?? "LibreHR" })}
        </p>
        <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          {t("invitedAs", { role: roleLabel(invite?.role ?? "employee") })}
        </span>
      </div>

      <div className="rounded-card border border-border bg-surface p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-card bg-danger/10 p-3 text-sm text-danger"
            >
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="user-name"
              className="text-xs font-medium text-foreground"
            >
              {t("nameLabel")}
            </label>
            <Input
              id="user-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="user-pass"
              className="text-xs font-medium text-foreground"
            >
              {t("passwordLabel")}
            </label>
            <Input
              id="user-pass"
              type="password"
              required
              minLength={8}
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full gap-2">
            <Check className="h-4 w-4" />
            <span>{submitting ? tCommon("loading") : t("submit")}</span>
          </Button>
        </form>
      </div>
    </div>
  );
}
