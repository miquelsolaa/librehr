"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapPin, Plus, ArrowLeft } from "lucide-react";
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
} from "@openhr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import type { Location } from "@openhr/contracts";

export default function LocationsSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  const [locations, setLocations] = React.useState<Location[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Dialog state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [locName, setLocName] = React.useState("");
  const [city, setCity] = React.useState("");
  const [region, setRegion] = React.useState("CT");
  const [submitting, setSubmitting] = React.useState(false);

  const loadLocations = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.listLocations();
      setLocations(res);
    } catch {
      // offline / mock fallback
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiClient.createLocation({
        name: locName,
        city,
        region,
        country: "ES",
        timezone: "Europe/Madrid",
        legalEntityId:
          locations[0]?.legalEntityId ?? "00000000-0000-0000-0000-000000000001",
      });
      setLocName("");
      setCity("");
      setCreateOpen(false);
      loadLocations();
    } catch {
      // error handled
    } finally {
      setSubmitting(false);
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
            {t("locationsTitle")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("locationsDescription")}
          </p>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t("addLocation")}</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("addLocation")}</DialogTitle>
              <DialogDescription>
                Register an official work center (centro de trabajo) for public
                holidays and agreements.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreate} className="space-y-4">
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
                  placeholder="e.g. Barcelona Diagonal"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="loc-city"
                  className="text-xs font-medium text-foreground"
                >
                  {t("city")}
                </label>
                <Input
                  id="loc-city"
                  required
                  placeholder="e.g. Barcelona"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="loc-region"
                  className="text-xs font-medium text-foreground"
                >
                  {t("region")}
                </label>
                <select
                  id="loc-region"
                  className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option value="CT">Catalunya (CT)</option>
                  <option value="MD">Comunidad de Madrid (MD)</option>
                  <option value="AN">Andalucía (AN)</option>
                  <option value="VC">Comunitat Valenciana (VC)</option>
                  <option value="PV">País Vasco / Euskadi (PV)</option>
                  <option value="GA">Galicia (GA)</option>
                  <option value="IB">Illes Balears (IB)</option>
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
                <Button type="submit" disabled={submitting}>
                  {submitting ? tCommon("loading") : tCommon("save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-card border border-border bg-surface divide-y divide-border">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </div>
        ) : locations.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No work centers configured yet.
          </div>
        ) : (
          locations.map((loc) => (
            <div key={loc.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-btn bg-primary/10 text-primary">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {loc.name}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {loc.city}, {loc.region} ({loc.country}) &middot;{" "}
                    {loc.timezone}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
