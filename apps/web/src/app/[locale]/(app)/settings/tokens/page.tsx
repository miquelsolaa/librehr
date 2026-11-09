"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  KeyRound,
  Plus,
  ArrowLeft,
  Copy,
  Check,
  Trash2,
  AlertCircle,
  Clock,
  Shield,
} from "lucide-react";
import {
  Button,
  Input,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Badge,
} from "@librehr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import type {
  PersonalAccessTokenItem,
  PersonalAccessTokenScope,
} from "@librehr/contracts";

export default function TokensSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("tokens");
  const tCommon = useTranslations("common");

  const [tokens, setTokens] = React.useState<PersonalAccessTokenItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Create token dialog state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<PersonalAccessTokenScope[]>([
    "read",
  ]);
  const [expiresInDays, setExpiresInDays] = React.useState<number>(30);
  const [submitting, setSubmitting] = React.useState(false);

  // Reveal token dialog state
  const [revealOpen, setRevealOpen] = React.useState(false);
  const [revealedToken, setRevealedToken] = React.useState<string>("");
  const [copied, setCopied] = React.useState(false);

  const loadTokens = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.listTokens();
      setTokens(res);
    } catch {
      // offline / mock fallback
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const toggleScope = (scope: PersonalAccessTokenScope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (scopes.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiClient.createToken({
        name,
        scopes,
        expiresInDays: expiresInDays > 0 ? expiresInDays : undefined,
      });
      setName("");
      setScopes(["read"]);
      setExpiresInDays(30);
      setCreateOpen(false);

      // Show revealed token modal
      setRevealedToken(res.plainToken);
      setRevealOpen(true);
      setCopied(false);

      loadTokens();
    } catch {
      // error handled
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apiClient.revokeToken(id);
      loadTokens();
    } catch {
      // error handled
    }
  };

  const handleCopy = async () => {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href={`/${locale}/settings`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Settings</span>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t("createToken")}</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("createToken")}</DialogTitle>
              <DialogDescription>
                Create a scoped personal access token with a unique prefix for
                integrations.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="token-name"
                  className="text-xs font-medium text-foreground"
                >
                  {t("tokenName")}
                </label>
                <Input
                  id="token-name"
                  required
                  placeholder="e.g. CI/CD or Payroll Sync"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">
                  {t("tokenScopes")}
                </span>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {(["read", "write", "admin"] as const).map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => toggleScope(sc)}
                      className={`flex items-center justify-between rounded-md border p-2 text-xs font-medium transition-colors ${
                        scopes.includes(sc)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="capitalize">{sc}</span>
                      {scopes.includes(sc) && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="token-expires"
                  className="text-xs font-medium text-foreground"
                >
                  {t("expiresIn")}
                </label>
                <select
                  id="token-expires"
                  className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                >
                  <option value={30}>30 days</option>
                  <option value={60}>60 days</option>
                  <option value={90}>90 days</option>
                  <option value={365}>1 year</option>
                  <option value={0}>Never expire</option>
                </select>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                >
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || scopes.length === 0}
                >
                  {submitting ? tCommon("loading") : t("generate")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* One-time Reveal Dialog */}
      <Dialog open={revealOpen} onOpenChange={setRevealOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Shield className="h-5 w-5 text-emerald-500" />
              <span>Token Created Successfully</span>
            </DialogTitle>
            <DialogDescription className="text-amber-500 font-medium">
              {t("revealedNotice")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-raised p-3">
              <code className="flex-1 font-mono text-sm break-all select-all text-foreground">
                {revealedToken}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                className="shrink-0 gap-1.5"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span>{t("copied")}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>{t("copy")}</span>
                  </>
                )}
              </Button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
              <span>
                Use in headers: <code>Authorization: Bearer lhr_...</code>
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setRevealOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tokens List */}
      <div className="rounded-card border border-border bg-surface divide-y divide-border">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </div>
        ) : tokens.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("noTokens")}
          </div>
        ) : (
          tokens.map((token) => (
            <div
              key={token.id}
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 gap-4"
            >
              <div className="flex items-start sm:items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-primary/10 text-primary shrink-0 mt-0.5 sm:mt-0">
                  <KeyRound className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {token.name}
                    </h3>
                    <code className="text-xs bg-surface-raised px-1.5 py-0.5 rounded text-muted-foreground font-mono">
                      {token.prefix}...
                    </code>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <div className="flex gap-1">
                      {(Array.isArray(token.scopes)
                        ? token.scopes
                        : typeof token.scopes === "string"
                          ? (() => {
                              try {
                                const parsed = JSON.parse(token.scopes);
                                return Array.isArray(parsed) ? parsed : [];
                              } catch {
                                return [];
                              }
                            })()
                          : []
                      ).map((s: string) => (
                        <Badge
                          key={s}
                          variant="outline"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {s}
                        </Badge>
                      ))}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      &middot;
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {token.lastUsedAt
                        ? `Last used: ${new Date(token.lastUsedAt).toLocaleDateString()}`
                        : t("neverUsed")}
                    </span>
                    {token.expiresAt && (
                      <>
                        <span className="text-xs text-muted-foreground">
                          &middot;
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Expires:{" "}
                          {new Date(token.expiresAt).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5"
                  onClick={() => handleRevoke(token.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t("revoke")}</span>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
