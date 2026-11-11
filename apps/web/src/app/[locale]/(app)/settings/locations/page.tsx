"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  MapPin,
  Plus,
  CalendarDays,
  Sparkles,
  Trash2,
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
  PageHeader,
} from "@librehr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import { formatCalendarDate } from "@/lib/format";
import type { Location, Holiday, LegalEntityOption } from "@librehr/contracts";

export default function LocationsSettingsPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const tNav = useTranslations("nav");
  const tRegions = useTranslations("regions");

  const [locations, setLocations] = React.useState<Location[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState(false);
  const [actionError, setActionError] = React.useState<
    "actionError" | "legalEntityRequired" | null
  >(null);
  const [holidayError, setHolidayError] = React.useState(false);
  const [holidayActionError, setHolidayActionError] = React.useState(false);

  // Dialog state: Create location
  const [createOpen, setCreateOpen] = React.useState(false);
  const [legalEntities, setLegalEntities] = React.useState<LegalEntityOption[]>(
    [],
  );
  const [legalEntityId, setLegalEntityId] = React.useState("");
  const [legalEntitiesError, setLegalEntitiesError] = React.useState(false);
  const [legalEntitiesLoading, setLegalEntitiesLoading] = React.useState(false);
  const [newEntityName, setNewEntityName] = React.useState("");
  const [newEntityTaxId, setNewEntityTaxId] = React.useState("");
  const [creatingEntity, setCreatingEntity] = React.useState(false);
  const [entityCreateError, setEntityCreateError] = React.useState(false);
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
      setLoadError(false);
      const res = await apiClient.listLocations();
      setLocations(res);
    } catch {
      setLocations([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadLocations();
  }, [loadLocations]);

  const loadLegalEntities = React.useCallback(async () => {
    setLegalEntitiesLoading(true);
    setLegalEntitiesError(false);
    try {
      setLegalEntities(await apiClient.listLegalEntities());
    } catch {
      setLegalEntities([]);
      setLegalEntitiesError(true);
    } finally {
      setLegalEntitiesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (createOpen) void loadLegalEntities();
  }, [createOpen, loadLegalEntities]);

  const loadHolidays = React.useCallback(
    async (locId: string, year: number) => {
      try {
        setHolidaysLoading(true);
        setHolidayError(false);
        setHolidays([]);
        const res = await apiClient.listHolidays({ locationId: locId, year });
        setHolidays(res);
      } catch {
        setHolidays([]);
        setHolidayError(true);
      } finally {
        setHolidaysLoading(false);
      }
    },
    [],
  );

  const openHolidayDialog = (loc: Location) => {
    setHolidayLoc(loc);
    setHolidayActionError(false);
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
    setHolidayActionError(false);
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
      setHolidayActionError(true);
    } finally {
      setSeeding(false);
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayLoc || !newDate || !newName) return;
    setHolidayActionError(false);
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
      setHolidayActionError(true);
    } finally {
      setAddingHoliday(false);
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!holidayLoc) return;
    setHolidayActionError(false);
    try {
      await apiClient.deleteHoliday(id);
      loadHolidays(holidayLoc.id, selectedYear);
    } catch {
      setHolidayActionError(true);
    }
  };

  const handleCreateEntity = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntityCreateError(false);
    setCreatingEntity(true);
    try {
      const created = await apiClient.createLegalEntity({
        name: newEntityName.trim(),
        cif: newEntityTaxId.trim(),
        country: "ES",
      });
      setLegalEntities((current) => [...current, created]);
      setLegalEntityId(created.id);
      setNewEntityName("");
      setNewEntityTaxId("");
    } catch {
      setEntityCreateError(true);
    } finally {
      setCreatingEntity(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    if (!legalEntityId) {
      setActionError("legalEntityRequired");
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.createLocation({
        name: locName,
        city,
        region,
        country: "ES",
        timezone: "Europe/Madrid",
        legalEntityId,
      });
      setLocName("");
      setCity("");
      setLegalEntityId("");
      setCreateOpen(false);
      loadLocations();
    } catch {
      setActionError("actionError");
    } finally {
      setSubmitting(false);
    }
  };

  // A holiday's scope is a category, not a state, so it reads as plain text.
  const scopeLabel = (scope: string) =>
    scope === "national"
      ? t("scopeNational")
      : scope === "regional"
        ? t("scopeRegional")
        : scope === "local"
          ? t("scopeLocal")
          : t("scopeCompany");

  return (
    <div className="space-y-6">
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
        title={t("locationsTitle")}
        description={t("locationsDescription")}
        actions={
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
                  {t("locationDescription")}
                </DialogDescription>
              </DialogHeader>

              {!legalEntitiesLoading &&
                !legalEntitiesError &&
                legalEntities.length === 0 && (
                  <form
                    onSubmit={handleCreateEntity}
                    className="space-y-3 rounded-card border border-border p-4"
                  >
                    <p className="text-sm">{t("legalEntitiesEmpty")}</p>
                    {entityCreateError && (
                      <p role="alert" className="text-sm text-danger">
                        {t("legalEntityCreateError")}
                      </p>
                    )}
                    <div className="space-y-1">
                      <label htmlFor="entity-name" className="text-sm">
                        {t("legalEntityName")}
                      </label>
                      <Input
                        id="entity-name"
                        required
                        value={newEntityName}
                        onChange={(e) => setNewEntityName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="entity-tax-id" className="text-sm">
                        {t("legalEntityTaxId")}
                      </label>
                      <Input
                        id="entity-tax-id"
                        required
                        value={newEntityTaxId}
                        onChange={(e) => setNewEntityTaxId(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={creatingEntity}>
                      {creatingEntity
                        ? tCommon("loading")
                        : t("createLegalEntity")}
                    </Button>
                  </form>
                )}
              <form onSubmit={handleCreate} className="space-y-4">
                {actionError && (
                  <p role="alert" className="text-sm text-danger">
                    {t(actionError)}
                  </p>
                )}
                <div className="space-y-1.5">
                  <label
                    htmlFor="loc-entity"
                    className="text-xs font-medium text-foreground"
                  >
                    {t("legalEntityLabel")}
                  </label>
                  <select
                    id="loc-entity"
                    required
                    value={legalEntityId}
                    onChange={(e) => setLegalEntityId(e.target.value)}
                    disabled={legalEntitiesLoading || legalEntitiesError}
                    className="min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
                  >
                    <option value="">{t("legalEntityPlaceholder")}</option>
                    {legalEntities.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name}
                      </option>
                    ))}
                  </select>
                  {legalEntitiesLoading && (
                    <p role="status">{tCommon("loading")}</p>
                  )}
                  {legalEntitiesError && (
                    <div role="alert">
                      <p>{t("legalEntitiesLoadError")}</p>
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => void loadLegalEntities()}
                      >
                        {t("retry")}
                      </button>
                    </div>
                  )}
                  {!legalEntitiesLoading &&
                    !legalEntitiesError &&
                    legalEntities.length === 0 && (
                      <p>{t("legalEntitiesEmpty")}</p>
                    )}
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
                    placeholder={t("cityPlaceholder")}
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
                    {["CT", "MD", "AN", "VC", "PV", "GA", "IB"].map((code) => (
                      <option key={code} value={code}>
                        {tRegions(code)} ({code})
                      </option>
                    ))}
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
        }
      />

      <div className="rounded-card border border-border bg-surface divide-y divide-border">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </div>
        ) : loadError ? (
          <div role="alert" className="space-y-3 p-8 text-center text-sm">
            <p>{t("loadError")}</p>
            <Button variant="outline" onClick={() => void loadLocations()}>
              {t("retry")}
            </Button>
          </div>
        ) : locations.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {t("locationsEmpty")}
          </div>
        ) : (
          locations.map((loc) => (
            <div
              key={loc.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-input bg-primary/10 text-primary">
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
        <DialogContent size="panel" className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("holidaysForLocation", { location: holidayLoc?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("holidaysDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Year selector & Auto-seed action */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("holidayYear")}:
                </span>
                {[2025, 2026, 2027].map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => handleYearChange(y)}
                    aria-pressed={selectedYear === y}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      selectedYear === y
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "bg-surface text-muted-foreground hover:bg-accent"
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
                <Sparkles className="h-3.5 w-3.5 text-warning" />
                <span>
                  {seeding ? tCommon("loading") : t("seedOfficialHolidays")}
                </span>
              </Button>
            </div>

            {holidayActionError && (
              <p role="alert" className="text-sm text-danger">
                {t("actionError")}
              </p>
            )}
            {/* List of holidays */}
            <div className="rounded-card border border-border bg-surface divide-y divide-border">
              {holidaysLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  {tCommon("loading")}
                </div>
              ) : holidayError ? (
                <div role="alert" className="space-y-3 p-6 text-center text-sm">
                  <p>{t("holidayLoadError")}</p>
                  <Button
                    variant="outline"
                    onClick={() =>
                      holidayLoc &&
                      void loadHolidays(holidayLoc.id, selectedYear)
                    }
                  >
                    {t("retry")}
                  </Button>
                </div>
              ) : holidays.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  {t("noHolidays")}
                </div>
              ) : (
                holidays.map((h) => (
                  <div
                    key={h.id}
                    className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-3 py-1 pl-3 pr-1 text-sm sm:grid-cols-[4rem_minmax(0,1fr)_auto_auto]"
                  >
                    <time
                      dateTime={h.date}
                      className="tabular-nums text-muted-foreground"
                    >
                      {formatCalendarDate(h.date, locale, {
                        dateStyle: undefined,
                        day: "numeric",
                        month: "short",
                      })}
                    </time>
                    <span className="min-w-0 font-medium text-foreground">
                      {h.name}
                      <span className="block text-xs font-normal text-muted-foreground sm:hidden">
                        {scopeLabel(h.scope)}
                      </span>
                    </span>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {scopeLabel(h.scope)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteHoliday(h.id)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-input text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                      aria-label={`${tCommon("delete")}: ${h.name}`}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
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
              {tCommon("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
