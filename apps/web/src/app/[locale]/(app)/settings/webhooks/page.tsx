"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Webhook,
  Plus,
  ArrowLeft,
  Trash2,
  Copy,
  Check,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
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
import type { WebhookItem } from "@librehr/contracts";

const AVAILABLE_EVENTS = [
  "employee.created",
  "employee.updated",
  "employee.terminated",
  "leave.requested",
  "leave.approved",
  "leave.rejected",
  "time.clocked",
  "document.uploaded",
];

interface WebhookTestState {
  testing: boolean;
  result?:
    | {
        success: boolean;
        statusCode: number;
        durationMs: number;
        error?: string | null | undefined;
      }
    | undefined;
}

export default function WebhooksSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("webhooks");
  const tCommon = useTranslations("common");

  const [webhooks, setWebhooks] = React.useState<WebhookItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Modal create state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [selectedEvents, setSelectedEvents] = React.useState<string[]>([
    "employee.created",
    "leave.approved",
  ]);
  const [submitting, setSubmitting] = React.useState(false);

  // Test ping state
  const [testResults, setTestResults] = React.useState<
    Record<string, WebhookTestState>
  >({});

  // Secret copied state
  const [copiedSecretId, setCopiedSecretId] = React.useState<string | null>(
    null,
  );

  const loadWebhooks = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.listWebhooks();
      setWebhooks(res);
    } catch {
      // offline / mock fallback
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  const toggleEvent = (ev: string) => {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url || selectedEvents.length === 0) return;

    setSubmitting(true);
    try {
      const res = await apiClient.createWebhook({
        name,
        url,
        events: selectedEvents,
        enabled: true,
      });
      setWebhooks((prev) => [res, ...prev]);
      setName("");
      setUrl("");
      setSelectedEvents(["employee.created", "leave.approved"]);
      setCreateOpen(false);
    } catch (err) {
      console.error("Failed to create webhook", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t("deleteConfirm"))) return;

    try {
      await apiClient.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      console.error("Failed to delete webhook", err);
    }
  };

  const handleSendTestPing = async (id: string) => {
    setTestResults((prev) => ({
      ...prev,
      [id]: { testing: true },
    }));

    try {
      const result = await apiClient.testWebhook(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          testing: false,
          result: {
            success: result.success,
            statusCode: result.statusCode,
            durationMs: result.durationMs,
            error: result.error ?? null,
          },
        },
      }));

      // Update delivery status in local state
      setWebhooks((prev) =>
        prev.map((w) =>
          w.id === id
            ? {
                ...w,
                lastDeliveryStatus: result.statusCode,
                lastDeliveredAt: new Date(),
              }
            : w,
        ),
      );
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          testing: false,
          result: {
            success: false,
            statusCode: 0,
            durationMs: 0,
            error: err instanceof Error ? err.message : "Network error",
          },
        },
      }));
    }
  };

  const handleCopySecret = (id: string, secret: string) => {
    void navigator.clipboard.writeText(secret);
    setCopiedSecretId(id);
    setTimeout(() => setCopiedSecretId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Navigation Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`/${locale}/settings`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-btn border border-border bg-surface hover:bg-surface-raised transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Webhook className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("title")}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              {t("newWebhook")}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("newWebhook")}</DialogTitle>
              <DialogDescription>
                Configure an outbound endpoint with HMAC-SHA256 signature
                verification.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {t("name")}
                </label>
                <Input
                  required
                  placeholder="e.g. Slack HR Notifications"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {t("url")}
                </label>
                <Input
                  required
                  type="url"
                  placeholder="https://api.yourcompany.com/webhooks"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  {t("events")}
                </label>
                <div className="grid grid-cols-2 gap-2 border border-border rounded-btn p-3 max-h-48 overflow-y-auto">
                  {AVAILABLE_EVENTS.map((ev) => {
                    const checked = selectedEvents.includes(ev);
                    return (
                      <label
                        key={ev}
                        className="flex items-center gap-2 text-xs text-foreground cursor-pointer hover:text-primary transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEvent(ev)}
                          className="rounded border-border text-primary focus:ring-primary"
                        />
                        <span className="font-mono text-[11px]">{ev}</span>
                      </label>
                    );
                  })}
                </div>
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
                  disabled={
                    submitting || !name || !url || selectedEvents.length === 0
                  }
                >
                  {submitting ? "Saving..." : t("newWebhook")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Webhooks Listing */}
      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : webhooks.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-12 text-center">
          <Webhook className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">{t("noWebhooks")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {webhooks.map((hook) => {
            const testInfo = testResults[hook.id];
            const isCopied = copiedSecretId === hook.id;

            return (
              <div
                key={hook.id}
                className="rounded-card border border-border bg-surface p-5 space-y-4 shadow-sm"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-foreground">
                        {hook.name}
                      </h2>
                      <Badge variant={hook.enabled ? "default" : "secondary"}>
                        {hook.enabled ? t("enabled") : "Disabled"}
                      </Badge>
                      {hook.lastDeliveryStatus != null && (
                        <Badge
                          variant={
                            hook.lastDeliveryStatus >= 200 &&
                            hook.lastDeliveryStatus < 300
                              ? "outline"
                              : "danger"
                          }
                          className="text-[11px]"
                        >
                          HTTP {hook.lastDeliveryStatus}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs font-mono text-muted-foreground break-all">
                      {hook.url}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-xs"
                      disabled={testInfo?.testing}
                      onClick={() => handleSendTestPing(hook.id)}
                    >
                      {testInfo?.testing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("testing")}
                        </>
                      ) : (
                        <>
                          <Send className="h-3.5 w-3.5" />
                          {t("testPing")}
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(hook.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Test Result Pill */}
                {testInfo?.result && (
                  <div
                    className={`flex items-center gap-2 p-3 rounded-btn text-xs ${
                      testInfo.result.success
                        ? "bg-success/10 text-success border border-success/20"
                        : "bg-destructive/10 text-destructive border border-destructive/20"
                    }`}
                  >
                    {testInfo.result.success ? (
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    )}
                    <span>
                      {testInfo.result.success
                        ? `Ping delivered successfully (HTTP ${testInfo.result.statusCode} in ${testInfo.result.durationMs}ms)`
                        : `Delivery failed: ${testInfo.result.error ?? `HTTP ${testInfo.result.statusCode}`}`}
                    </span>
                  </div>
                )}

                {/* Subscribed Events & Secret */}
                <div className="pt-2 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground mr-1">Events:</span>
                    {hook.events.map((ev) => (
                      <span
                        key={ev}
                        className="px-2 py-0.5 rounded-full bg-surface-raised border border-border text-[11px] font-mono text-foreground"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {t("secret")}:
                    </span>
                    <code className="bg-surface-raised px-2 py-0.5 rounded border border-border font-mono text-[11px] text-muted-foreground">
                      {hook.secret.slice(0, 10)}...
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopySecret(hook.id, hook.secret)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy Secret"
                    >
                      {isCopied ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
