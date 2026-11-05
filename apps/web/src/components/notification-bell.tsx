"use client";

import * as React from "react";
import { Bell, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";
import type { NotificationItem } from "@librehr/contracts";

export function NotificationBell() {
  const t = useTranslations("notifications");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<"signIn" | "unavailable" | null>(
    null,
  );
  const [actionError, setActionError] = React.useState(false);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>(
    [],
  );

  const fetchNotifications = React.useCallback(async () => {
    const session = getStoredSession();
    if (!session?.token) {
      setNotifications([]);
      setUnreadCount(0);
      setError("signIn");
      return;
    }

    try {
      const client = getApiClient(session.token);
      const res = await client.listNotifications();
      setError(null);
      setNotifications(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
      setError("unavailable");
    }
  }, []);

  React.useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    const session = getStoredSession();
    if (!session?.token) return;

    setActionError(false);
    try {
      const client = getApiClient(session.token);
      await client.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      setActionError(true);
    }
  };

  const markAllRead = async () => {
    const session = getStoredSession();
    if (!session?.token) return;

    setActionError(false);
    try {
      const client = getApiClient(session.token);
      await client.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      setActionError(true);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <Bell className="h-4 w-4 text-foreground" aria-hidden="true" />
        <span className="sr-only">{t("title")}</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-md border border-border bg-card p-4 shadow-lg z-50">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <h4 className="text-sm font-semibold text-foreground">
              {t("title")}
            </h4>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t("unreadCount", { count: unreadCount })}
              </span>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-[11px] text-primary hover:underline font-medium"
                >
                  {t("markAllRead")}
                </button>
              )}
            </div>
          </div>

          {actionError && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {t("actionError")}
            </p>
          )}
          <div className="mt-2 max-h-64 overflow-y-auto space-y-2">
            {error ? (
              <div
                role="status"
                className="py-4 text-center text-xs text-muted-foreground"
              >
                <p>{t(error)}</p>
                {error === "unavailable" && (
                  <button
                    type="button"
                    className="mt-2 text-primary underline"
                    onClick={() => void fetchNotifications()}
                  >
                    {t("retry")}
                  </button>
                )}
              </div>
            ) : notifications.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {t("empty")}
              </p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`flex items-start justify-between p-2 rounded-md border text-xs ${
                    n.read
                      ? "bg-muted/40 border-transparent text-muted-foreground"
                      : "bg-primary/5 border-primary/20 text-foreground"
                  }`}
                >
                  <div className="flex-1 pr-2">
                    <p className="font-semibold">{n.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {n.body}
                    </p>
                  </div>
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => void markAsRead(n.id)}
                      className="text-primary hover:text-primary/80 p-1"
                      title={t("markRead")}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
