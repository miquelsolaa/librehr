"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  MapPin,
  Plus,
  ArrowLeft,
  CalendarDays,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Button,
  Input,
  Badge,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@librehr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import type { Location, Holiday } from "@librehr/contracts";

export default function LocationsSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  const [locations, setLocations] = React.useState<Location[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Dialog state: Create location
  const [createOpen, setCreateOpen] = React.useState(false);
  const [locName, setLocName] = React.useState("");
  const [city, setCity] = React.useState("");
  const [region, setRegion] = React.useState("CT");
  const [submitting, setSubmitting] = React.useState(false);

  // Dialog state: Manage Location Holidays (LEA-003)
  const [holidayLoc, setHolidayLoc] = React.useState<Location | null>(null);
  const [selectedYear, setSelectedYear] = React.useState(2026);
  const [holidays, setHolidays] = React.useState<Holiday[]>([]);
  const [holidaysLoading, setHolidaysLoading] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);

  // Add holiday form state
  const [newDate, setNewDate] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const [newScope, setNewScope] = React.useState<"local" | "company">("local");
  const [addingHoliday, setAddingHoliday] = React.useState(false);

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

  const loadHolidays = React.useCallback(
    async (locId: string, year: number) => {
      try {
        setHolidaysLoading(true);
        const res = await apiClient.listHolidays({ locationId: locId, year });
        setHolidays(res);
      } catch {
        setHolidays([]);
      } finally {
        setHolidaysLoading(false);
      }
    },
    [],
  );

  const openHolidayDialog = (loc: Location) => {
    setHolidayLoc(loc);
    loadHolidays(loc.id, selectedYear);
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    if (holidayLoc) {
      loadHolidays(holidayLoc.id, year);
    }
  };

  const handleSeedHolidays = async () => {
    if (!holidayLoc) return;
    try {
      setSeeding(true);
      const res = await apiClient.seedStatutoryHolidays({
        locationId: holidayLoc.id,
        year: selectedYear,
        region: holidayLoc.region,
        city: holidayLoc.city,
      });
      setHolidays(res);
    } catch {
      // handle error
    } finally {
      setSeeding(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayLoc || !newDate || !newName) return;
    try {
      setAddingHoliday(true);
      await apiClient.createHoliday({
        locationId: holidayLoc.id,
        year: selectedYear,
        date: newDate,
        name: newName,
        scope: newScope,
      });
      setNewDate("");
      setNewName("");
      loadHolidays(holidayLoc.id, selectedYear);
    } catch {
      // error handled
    } finally {
      setAddingHoliday(false);
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!holidayLoc) return;
    try {
      await apiClient.deleteHoliday(id);
      loadHolidays(holidayLoc.id, selectedYear);
    } catch {
      // error handled
    }
  };

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

  const getScopeBadge = (scope: string) => {
    switch (scope) {
      case "national":
        return <Badge variant="info">{t("scopeNational")}</Badge>;
      case "regional":
        return (
          <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
            {t("scopeRegional")}
          </span>
        );
      case "local":
        return <Badge variant="success">{t("scopeLocal")}</Badge>;
      case "company":
      default:
        return <Badge variant="warning">{t("scopeCompany")}</Badge>;
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
            <div
              key={loc.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
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

              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => openHolidayDialog(loc)}
              >
                <CalendarDays className="h-4 w-4 text-primary" />
                <span>{t("manageHolidays")}</span>
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Location Holiday Calendar Modal (LEA-003) */}
      <Dialog
        open={Boolean(holidayLoc)}
        onOpenChange={(open) => !open && setHolidayLoc(null)}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <span>
                {t("holidaysForLocation", { location: holidayLoc?.name ?? "" })}
              </span>
            </DialogTitle>
            <DialogDescription>{t("holidaysDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Year selector & Auto-seed action */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Year:
                </span>
                {[2025, 2026, 2027].map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => handleYearChange(y)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      selectedYear === y
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "bg-surface text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                disabled={seeding}
                onClick={handleSeedHolidays}
              >
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>
                  {seeding ? tCommon("loading") : t("seedOfficialHolidays")}
                </span>
              </Button>
            </div>

            {/* List of holidays */}
            <div className="rounded-card border border-border bg-card divide-y divide-border">
              {holidaysLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  {tCommon("loading")}
                </div>
              ) : holidays.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  {t("noHolidays")}
                </div>
              ) : (
                holidays.map((h) => (
                  <div
                    key={h.id}
                    className="flex items-center justify-between p-3 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono font-medium text-foreground">
                        {h.date}
                      </span>
                      <span className="font-medium text-foreground">
                        {h.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {getScopeBadge(h.scope)}
                      <button
                        type="button"
                        onClick={() => handleDeleteHoliday(h.id)}
                        className="rounded p-1 text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors"
                        title={tCommon("delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add custom holiday form */}
            <form
              onSubmit={handleAddHoliday}
              className="rounded-lg border border-border p-3 space-y-3 bg-surface/50"
            >
              <h4 className="text-xs font-semibold text-foreground">
                {t("addCustomHoliday")}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
                <div>
                  <Input
                    required
                    placeholder={t("holidayName")}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={newScope}
                    onChange={(e) =>
                      setNewScope(e.target.value as "local" | "company")
                    }
                    className="flex-1 rounded-input border border-border bg-background px-2 text-xs text-foreground"
                  >
                    <option value="local">{t("scopeLocal")}</option>
                    <option value="company">{t("scopeCompany")}</option>
                  </select>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={addingHoliday}
                    className="h-8 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </form>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setHolidayLoc(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
