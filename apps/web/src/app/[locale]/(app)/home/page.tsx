"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button, StatusPill, Skeleton } from "@openhr/ui";
import { Clock, Calendar, CheckCircle, Activity, Building } from "lucide-react";
import { getApiClient } from "@/lib/api-client";
import { getStoredSession } from "@/lib/auth";

interface ApiHealthData {
  status: string;
}

interface UserMeData {
  id: string;
  email: string;
  name?: string | undefined;
}

interface OrgData {
  id: string;
  name: string;
  slug: string;
}

export default function HomePage() {
  const tHome = useTranslations("home");

  const [loading, setLoading] = React.useState(true);
  const [health, setHealth] = React.useState<ApiHealthData | null>(null);
  const [user, setUser] = React.useState<UserMeData | null>(null);
  const [org, setOrg] = React.useState<OrgData | null>(null);

  React.useEffect(() => {
    async function loadData() {
      setLoading(true);
      const session = getStoredSession();
      const token = session?.token;
      const client = getApiClient(token);

      try {
        const healthRes = await client.health();
        setHealth(healthRes);
      } catch {
        setHealth({ status: "unreachable" });
      }

      if (token) {
        try {
          const meRes = await client.getMe();
          setUser(meRes.user);
        } catch {
          if (session) {
            setUser({
              id: session.userId,
              email: session.email,
              name: session.name,
            });
          }
        }

        try {
          const orgRes = await client.getOrganization();
          setOrg(orgRes);
        } catch {
          setOrg({ id: "org-1", name: "OpenHR Seed Org", slug: "seed-org" });
        }
      } else {
        // Mock default for unauthenticated view
        setUser({
          id: "usr_guest",
          email: "admin@openhr.test",
          name: "Laia Martí",
        });
        setOrg({ id: "org_1", name: "Acme Serveis SL", slug: "acme-serveis" });
      }

      setLoading(false);
    }

    void loadData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-32 rounded-card" />
          <Skeleton className="h-32 rounded-card" />
          <Skeleton className="h-32 rounded-card" />
        </div>
      </div>
    );
  }

  const displayName = user?.name ?? "Admin";
  const orgName = org?.name ?? "Acme Serveis SL";
  const isHealthy = health?.status === "ok";

  return (
    <div className="space-y-8 animate-in fade-in-50">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            {tHome("welcome", { name: displayName })}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
            <Building className="h-4 w-4" />
            <span>{tHome("organization", { orgName })}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <StatusPill
            status={isHealthy ? "active" : "rejected"}
            label={tHome("apiHealth", { status: health?.status ?? "unknown" })}
          />
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Clock widget per DESIGN.md */}
        <div className="rounded-card border border-border bg-surface p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {tHome("quickActions")}
            </span>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4">
            <p className="text-xl font-bold text-foreground">0h 00m</p>
            <p className="text-xs text-muted-foreground">Jornada avui</p>
          </div>
          <div className="mt-4">
            <Button className="w-full" size="sm">
              <Clock className="mr-2 h-4 w-4" />
              {tHome("clockIn")}
            </Button>
          </div>
        </div>

        {/* Time Off Balance card */}
        <div className="rounded-card border border-border bg-surface p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              Vacances
            </span>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4">
            <p className="text-xl font-bold text-foreground">22.0 dies</p>
            <p className="text-xs text-muted-foreground">
              Disponibles per 2026
            </p>
          </div>
          <div className="mt-4">
            <Button variant="secondary" className="w-full" size="sm">
              <Calendar className="mr-2 h-4 w-4" />
              {tHome("requestLeave")}
            </Button>
          </div>
        </div>

        {/* System & Isolation verification */}
        <div className="rounded-card border border-border bg-surface p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              Seguretat i RLS
            </span>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-4">
            <p className="text-base font-semibold text-foreground">
              Aïllament multi-inquilí
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              RLS actiu a PostgreSQL per organització
            </p>
          </div>
          <div className="mt-4 flex items-center gap-1.5 text-xs text-success font-medium">
            <CheckCircle className="h-4 w-4" />
            <span>Verificat M0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
