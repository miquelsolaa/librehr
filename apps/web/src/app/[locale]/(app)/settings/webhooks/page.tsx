"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Webhook,
  Plus,
  Trash2,
  Copy,
  Check,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
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
  PageHeader,
  ConfirmDialog,
} from "@librehr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import {
  WEBHOOK_SUBSCRIBABLE_EVENTS,
  type WebhookItem,
  type WebhookSubscribableEvent,
} from "@librehr/contracts";

const AVAILABLE_EVENTS = WEBHOOK_SUBSCRIBABLE_EVENTS;

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
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tSettings = useTranslations("settings");

  const [webhooks, setWebhooks] = React.useState<WebhookItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [actionError, setActionError] = React.useState(false);

  // Modal create state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [selectedEvents, setSelectedEvents] = React.useState<
    WebhookSubscribableEvent[]
  >(["employee.created", "leave.approved"]);
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
      setLoadError(false);
      const res = await apiClient.listWebhooks();
      setWebhooks(res);
    } catch {
      setWebhooks([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  const toggleEvent = (ev: WebhookSubscribableEvent) => {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !url || selectedEvents.length === 0) return;

    setSubmitting(true);
    setActionError(false);
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
    } catch {
      setActionError(true);
    } finally {
      setSubmitting(false);
    }
  };

  const [pendingDelete, setPendingDelete] = React.useState<WebhookItem | null>(
    null,
  );

  const handleDelete = async (id: string) => {
    setActionError(false);
    try {
      await apiClient.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch {
      setActionError(true);
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
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          testing: false,
          result: {
            success: false,
            statusCode: 0,
            durationMs: 0,
            error: null,
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
      <PageHeader
        breadcrumb={
          <Link
            href={`/${locale}/settings`}
            className="inline-flex items-center gap-1 rounded-input text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tNav("settings")}
          </Link>
        }
        title={t("title")}
        description={t("subtitle")}
        actions={
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
                <DialogDescription>{t("createDescription")}</DialogDescription>
              </DialogHeader>

              <form onSubmit={handleCreate} className="space-y-4">
                {actionError && (
                  <p role="alert" className="text-sm text-danger">
                    {tSettings("actionError")}
                  </p>
                )}
                <div className="space-y-2">
                  <label
                    htmlFor="webhook-name"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("name")}
                  </label>
                  <Input
                    id="webhook-name"
                    required
                    placeholder={t("namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="webhook-url"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("url")}
                  </label>
                  <Input
                    id="webhook-url"
                    required
                    type="url"
                    placeholder="https://api.example.com/webhooks"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <span
                    id="webhook-events-label"
                    className="text-sm font-medium text-foreground"
                  >
                    {t("events")}
                  </span>
                  <div
                    role="group"
                    aria-labelledby="webhook-events-label"
                    className="grid grid-cols-2 gap-2 border border-border rounded-input p-3 max-h-48 overflow-y-auto"
                  >
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
                          <span className="font-mono text-xs">{ev}</span>
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
                    {submitting ? t("saving") : t("newWebhook")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {actionError && !createOpen && (
        <p role="alert" className="text-sm text-danger">
          {tSettings("actionError")}
        </p>
      )}

      {/* Webhooks Listing */}
      {loading ? (
        <div role="status" className="flex justify-center p-12">
          <Loader2
            className="h-8 w-8 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">{tCommon("loading")}</span>
        </div>
      ) : loadError ? (
        <div role="alert" className="space-y-3 p-8 text-center text-sm">
          <p>{tSettings("loadError")}</p>
          <Button variant="outline" onClick={() => void loadWebhooks()}>
            {tSettings("retry")}
          </Button>
        </div>
      ) : webhooks.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-12 text-center">
          <Webhook
            className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3"
            aria-hidden="true"
          />
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
                className="rounded-card border border-border bg-surface p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-foreground">
                        {hook.name}
                      </h2>
                      <Badge variant={hook.enabled ? "default" : "secondary"}>
                        {hook.enabled ? t("enabled") : t("disabled")}
                      </Badge>
                      {hook.lastDeliveryStatus != null && (
                        <Badge
                          variant={
                            hook.lastDeliveryStatus >= 200 &&
                            hook.lastDeliveryStatus < 300
                              ? "outline"
                              : "danger"
                          }
                          className="text-xs"
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
                      className="text-danger hover:bg-danger/10"
                      onClick={() => setPendingDelete(hook)}
                      aria-label={t("deleteWebhook", { name: hook.name })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>

                {/* Test Result Pill */}
                {testInfo?.result && (
                  <div
                    className={`flex items-center gap-2 p-3 rounded-input text-xs ${
                      testInfo.result.success
                        ? "bg-success/10 text-success border border-success/20"
                        : "bg-danger/10 text-danger border border-danger/20"
                    }`}
                  >
                    {testInfo.result.success ? (
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    )}
                    <span>
                      {testInfo.result.success
                        ? t("testSuccess", {
                            statusCode: testInfo.result.statusCode,
                            durationMs: testInfo.result.durationMs,
                          })
                        : t("testError", {
                            error:
                              testInfo.result.error ??
                              (testInfo.result.statusCode > 0
                                ? `HTTP ${testInfo.result.statusCode}`
                                : t("networkError")),
                          })}
                    </span>
                  </div>
                )}

                {/* Subscribed Events & Secret */}
                <div className="pt-2 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground mr-1">
                      {t("eventsLabel")}:
                    </span>
                    {(Array.isArray(hook.events)
                      ? hook.events
                      : typeof hook.events === "string"
                        ? (() => {
                            try {
                              const parsed = JSON.parse(hook.events);
                              return Array.isArray(parsed) ? parsed : [];
                            } catch {
                              return [];
                            }
                          })()
                        : []
                    ).map((ev: string) => (
                      <span
                        key={ev}
                        className="px-2 py-0.5 rounded-full bg-surface-raised border border-border text-xs font-mono text-foreground"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>

                  {/* The API returns the secret only right after creation
                      or rotation, so it can be copied once. */}
                  {hook.secret && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {t("secret")}:
                      </span>
                      <code className="bg-surface-raised px-2 py-0.5 rounded border border-border font-mono text-xs text-muted-foreground">
                        {hook.secret.slice(0, 10)}...
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopySecret(hook.id, hook.secret ?? "")
                        }
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title={t("copySecret")}
                        aria-label={
                          isCopied ? tCommon("copied") : t("copySecret")
                        }
                      >
                        {isCopied ? (
                          <Check
                            className="h-3.5 w-3.5 text-success"
                            aria-hidden="true"
                          />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={t("deleteConfirm")}
        description={pendingDelete?.name ?? ""}
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete.id);
        }}
      />
    </div>
  );
}
