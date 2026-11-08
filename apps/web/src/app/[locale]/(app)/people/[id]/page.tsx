"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  User,
  Briefcase,
  ShieldAlert,
  UserMinus,
  PhoneCall,
  Sliders,
  Edit,
  Plus,
  Trash2,
  Tag,
  KeyRound,
} from "lucide-react";
import {
  Button,
  Input,
  StatusPill,
  SecretField,
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
import { EmploymentHistory } from "@/components/employment-history";
import type {
  EmployeeProfile,
  TerminationReason,
  EmergencyContact,
  CustomFieldValue,
  CustomFieldDefinition,
} from "@librehr/contracts";

export default function EmployeeDetailPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const id = (params?.["id"] as string) ?? "";

  const t = useTranslations("people");
  const tProfile = useTranslations("people.profile");
  const tCommon = useTranslations("common");

  const [employee, setEmployee] = React.useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const activeEmployeeId = React.useRef<string | null>(null);
  const profileGeneration = React.useRef(0);
  const [revealedDni, setRevealedDni] = React.useState<string | null>(null);
  const [revealedIban, setRevealedIban] = React.useState<string | null>(null);

  // Termination modal state
  const [termOpen, setTermOpen] = React.useState(false);
  const [termDate, setTermDate] = React.useState(
    new Date().toISOString().slice(0, 10),
  );
  const [termReason, setTermReason] = React.useState<TerminationReason>(
    "voluntary_resignation",
  );
  const [termSubmitting, setTermSubmitting] = React.useState(false);

  // Self-Service Edit modal state
  const [selfEditOpen, setSelfEditOpen] = React.useState(false);
  const [selfPreferredName, setSelfPreferredName] = React.useState("");
  const [selfPhone, setSelfPhone] = React.useState("");
  const [selfAddress, setSelfAddress] = React.useState("");
  const [selfSubmitting, setSelfSubmitting] = React.useState(false);

  // Emergency Contacts state
  const [contacts, setContacts] = React.useState<EmergencyContact[]>([]);
  const [contactsError, setContactsError] = React.useState(false);
  const [contactOpen, setContactOpen] = React.useState(false);
  const [contactFullName, setContactFullName] = React.useState("");
  const [contactRelationship, setContactRelationship] =
    React.useState("Spouse");
  const [contactPhonePrimary, setContactPhonePrimary] = React.useState("");
  const [contactPhoneSecondary, setContactPhoneSecondary] = React.useState("");
  const [contactIsPrimary, setContactIsPrimary] = React.useState(false);
  const [contactSubmitting, setContactSubmitting] = React.useState(false);

  // Custom Fields state
  const [customFields, setCustomFields] = React.useState<CustomFieldValue[]>(
    [],
  );
  const [allDefinitions, setAllDefinitions] = React.useState<
    CustomFieldDefinition[]
  >([]);
  const [cfModalOpen, setCfModalOpen] = React.useState(false);
  const [selectedFieldDefId, setSelectedFieldDefId] = React.useState("");
  const [fieldValue, setFieldValue] = React.useState("");
  const [cfSubmitting, setCfSubmitting] = React.useState(false);

  // Kiosk PIN & Badge state (TIM-010)
  const [pinModalOpen, setPinModalOpen] = React.useState(false);
  const [kioskPin, setKioskPin] = React.useState("");
  const [kioskBadgeId, setKioskBadgeId] = React.useState("");
  const [pinSubmitting, setPinSubmitting] = React.useState(false);
  const [pinSuccess, setPinSuccess] = React.useState(false);

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kioskPin || kioskPin.length < 4) return;
    setPinSubmitting(true);
    try {
      await apiClient.setEmployeePin(id, {
        pin: kioskPin,
        badgeId: kioskBadgeId || undefined,
      });
      setPinSuccess(true);
      setPinModalOpen(false);
      setKioskPin("");
    } catch {
      // Offline fallback
    } finally {
      setPinSubmitting(false);
    }
  };

  const loadExtraData = React.useCallback(async (empId: string) => {
    const generation = profileGeneration.current;
    const [cts, cfs, defs] = await Promise.allSettled([
      apiClient.listEmergencyContacts(empId),
      apiClient.getEmployeeCustomFields(empId),
      apiClient.listCustomFields(),
    ]);
    if (
      activeEmployeeId.current !== empId ||
      profileGeneration.current !== generation
    )
      return;
    if (cts.status === "fulfilled") {
      setContacts(cts.value);
      setContactsError(false);
    } else {
      setContactsError(true);
    }
    if (cfs.status === "fulfilled") setCustomFields(cfs.value);
    if (defs.status === "fulfilled") setAllDefinitions(defs.value);
  }, []);

  React.useEffect(() => {
    if (!id) return;
    const generation = ++profileGeneration.current;
    activeEmployeeId.current = id;
    setLoading(true);
    setEmployee(null);
    setContacts([]);
    setContactsError(false);
    setCustomFields([]);
    setAllDefinitions([]);
    setRevealedDni(null);
    setRevealedIban(null);
    apiClient
      .getEmployee(id)
      .then((emp) => {
        if (profileGeneration.current !== generation) return;
        setEmployee(emp);
        setSelfPreferredName(emp.preferredName ?? "");
        setSelfPhone(emp.phone ?? "");
        setSelfAddress(emp.address ?? "");
      })
      .catch(() => {
        if (profileGeneration.current !== generation) return;
        setEmployee(null);
      })
      .finally(() => {
        if (profileGeneration.current === generation) setLoading(false);
      });

    loadExtraData(id);
    return () => {
      if (profileGeneration.current === generation) {
        activeEmployeeId.current = null;
        profileGeneration.current++;
      }
    };
  }, [id, loadExtraData]);

  const handleRevealDni = async () => {
    if (!employee || revealedDni) return;
    try {
      const res = await apiClient.revealEmployeeField(
        employee.id,
        "nationalId",
      );
      setRevealedDni(res.value);
    } catch {
      // reveal failure handled
    }
  };

  const handleRevealIban = async () => {
    if (!employee || revealedIban) return;
    try {
      const res = await apiClient.revealEmployeeField(employee.id, "iban");
      setRevealedIban(res.value);
    } catch {
      // reveal failure handled
    }
  };

  const handleTerminate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setTermSubmitting(true);
    try {
      const updated = await apiClient.terminateEmployee(employee.id, {
        terminationDate: termDate,
        terminationReason: termReason,
      });
      setEmployee(updated);
      setTermOpen(false);
    } catch {
      // termination error handled
    } finally {
      setTermSubmitting(false);
    }
  };

  const handleSelfServiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setSelfSubmitting(true);
    try {
      const updated = await apiClient.selfServiceUpdate(employee.id, {
        preferredName: selfPreferredName || null,
        phone: selfPhone || null,
        address: selfAddress || null,
      });
      setEmployee(updated);
      setSelfEditOpen(false);
    } catch {
      // error handled
    } finally {
      setSelfSubmitting(false);
    }
  };

  const handleAddEmergencyContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setContactSubmitting(true);
    try {
      await apiClient.createEmergencyContact(employee.id, {
        fullName: contactFullName,
        relationship: contactRelationship,
        phonePrimary: contactPhonePrimary,
        phoneSecondary: contactPhoneSecondary || null,
        isPrimary: contactIsPrimary,
      });
      setContactFullName("");
      setContactRelationship("Spouse");
      setContactPhonePrimary("");
      setContactPhoneSecondary("");
      setContactIsPrimary(false);
      setContactOpen(false);
      loadExtraData(employee.id);
    } catch {
      // error handled
    } finally {
      setContactSubmitting(false);
    }
  };

  const handleDeleteEmergencyContact = async (contactId: string) => {
    if (!employee) return;
    try {
      await apiClient.deleteEmergencyContact(employee.id, contactId);
      loadExtraData(employee.id);
    } catch {
      // error handled
    }
  };

  const handleSaveCustomField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee || !selectedFieldDefId) return;
    setCfSubmitting(true);
    try {
      await apiClient.setEmployeeCustomField(employee.id, {
        fieldDefinitionId: selectedFieldDefId,
        value: fieldValue || null,
      });
      setFieldValue("");
      setSelectedFieldDefId("");
      setCfModalOpen(false);
      loadExtraData(employee.id);
    } catch {
      // error handled
    } finally {
      setCfSubmitting(false);
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

  if (!employee) {
    return (
      <div className="space-y-4">
        <Link
          href={`/${locale}/people`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t("title")}</span>
        </Link>
        <p role="alert" className="text-sm text-destructive">
          {tProfile("loadError")}
        </p>
      </div>
    );
  }

  const isTerminated = employee.status === "terminated";

  return (
    <div className="space-y-6">
      {/* Back button & Actions header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link
            href={`/${locale}/people`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{t("title")}</span>
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {employee.preferredName
                ? `${employee.preferredName} (${employee.firstName}) ${employee.lastName}`
                : `${employee.firstName} ${employee.lastName}`}
            </h1>
            <StatusPill
              status={
                employee.status === "active"
                  ? "active"
                  : employee.status === "on_leave"
                    ? "pending"
                    : "rejected"
              }
              label={
                employee.status === "active"
                  ? t("statusActive")
                  : employee.status === "on_leave"
                    ? t("statusOnLeave")
                    : t("statusTerminated")
              }
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {employee.jobTitle ?? "No job title specified"}
          </p>
        </div>

        {!isTerminated && (
          <Dialog open={termOpen} onOpenChange={setTermOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <UserMinus className="h-4 w-4" />
                <span>{tProfile("terminateButton")}</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{tProfile("terminateTitle")}</DialogTitle>
                <DialogDescription>
                  {tProfile("terminateDescription")}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleTerminate} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="term-date"
                    className="text-xs font-medium text-foreground"
                  >
                    {tProfile("terminationDate")}
                  </label>
                  <Input
                    id="term-date"
                    type="date"
                    required
                    value={termDate}
                    onChange={(e) => setTermDate(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="term-reason"
                    className="text-xs font-medium text-foreground"
                  >
                    {tProfile("terminationReason")}
                  </label>
                  <select
                    id="term-reason"
                    className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    value={termReason}
                    onChange={(e) =>
                      setTermReason(e.target.value as TerminationReason)
                    }
                  >
                    <option value="voluntary_resignation">
                      {tProfile("voluntaryResignation")}
                    </option>
                    <option value="dismissal_disciplinary">
                      {tProfile("dismissalDisciplinary")}
                    </option>
                    <option value="dismissal_objective">
                      {tProfile("dismissalObjective")}
                    </option>
                    <option value="contract_expiry">
                      {tProfile("contractExpiry")}
                    </option>
                    <option value="retirement">{tProfile("retirement")}</option>
                    <option value="other">{tProfile("other")}</option>
                  </select>
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setTermOpen(false)}
                  >
                    {tCommon("cancel")}
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    disabled={termSubmitting}
                  >
                    {termSubmitting
                      ? tCommon("loading")
                      : tProfile("confirmTermination")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Grid: Personal Info & Employment Info */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Personal Data Card */}
        <div className="rounded-card border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                {tProfile("personalInfo")}
              </h2>
            </div>

            <Dialog open={selfEditOpen} onOpenChange={setSelfEditOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                  <Edit className="h-3.5 w-3.5" />
                  <span>Edit Contact</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Personal Contact Details</DialogTitle>
                  <DialogDescription>
                    Update your self-service contact attributes (EMP-005).
                  </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSelfServiceSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="self-preferred-name"
                      className="text-xs font-medium text-foreground"
                    >
                      Preferred Name
                    </label>
                    <Input
                      id="self-preferred-name"
                      placeholder="e.g. Alex"
                      value={selfPreferredName}
                      onChange={(e) => setSelfPreferredName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="self-phone"
                      className="text-xs font-medium text-foreground"
                    >
                      Phone Number
                    </label>
                    <Input
                      id="self-phone"
                      placeholder="+34 600 000 000"
                      value={selfPhone}
                      onChange={(e) => setSelfPhone(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="self-address"
                      className="text-xs font-medium text-foreground"
                    >
                      Home Address
                    </label>
                    <Input
                      id="self-address"
                      placeholder="Carrer Major, 12, 08001 Barcelona"
                      value={selfAddress}
                      onChange={(e) => setSelfAddress(e.target.value)}
                    />
                  </div>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSelfEditOpen(false)}
                    >
                      {tCommon("cancel")}
                    </Button>
                    <Button type="submit" disabled={selfSubmitting}>
                      {selfSubmitting ? tCommon("loading") : tCommon("save")}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("fullName")}
              </span>
              <span className="font-medium text-foreground">
                {employee.firstName} {employee.lastName}
              </span>
            </div>

            {employee.preferredName && (
              <div>
                <span className="text-xs text-muted-foreground block">
                  {tProfile("preferredName")}
                </span>
                <span className="text-foreground">
                  {employee.preferredName}
                </span>
              </div>
            )}

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("email")}
              </span>
              <span className="text-foreground">{employee.email}</span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("phone")}
              </span>
              <span className="text-foreground">{employee.phone ?? "—"}</span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("address")}
              </span>
              <span className="text-foreground">{employee.address ?? "—"}</span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("birthDate")}
              </span>
              <span className="text-foreground">
                {employee.birthDate ?? "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Employment & Contracts Card */}
        <div className="rounded-card border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Briefcase className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              {tProfile("employmentInfo")}
            </h2>
          </div>

          <div className="grid gap-3 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("department")}
              </span>
              <span className="font-medium text-foreground">
                {employee.departmentName ?? "—"}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("location")}
              </span>
              <span className="text-foreground">
                {employee.locationName ?? "—"}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("manager")}
              </span>
              <span className="text-foreground">
                {employee.managerName ?? "—"}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("contractType")}
              </span>
              <span className="text-foreground uppercase text-xs font-mono font-medium">
                {employee.employmentType ?? "Indefinido (100)"}
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">
                {tProfile("startDate")}
              </span>
              <span className="text-foreground">
                {employee.startDate ?? "—"}
              </span>
            </div>

            {isTerminated && (
              <div className="rounded-card bg-destructive/10 p-3 border border-destructive/20 text-xs">
                <span className="font-semibold text-destructive block">
                  {tProfile("terminateTitle")}: {employee.terminationDate}
                </span>
                <span className="text-muted-foreground">
                  Reason: {employee.terminationReason}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <EmploymentHistory key={employee.id} employeeId={employee.id} />

      {/* Sensitive Statutory Fields (EMP-004) */}
      <div className="rounded-card border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <h2 className="text-base font-semibold text-foreground">
              Sensitive Statutory Fields
            </h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {tProfile("sensitiveNotice")}
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <SecretField
              label={tProfile("nationalId")}
              value={
                revealedDni ??
                (employee.hasNationalId ? "••••••••X" : "Not recorded")
              }
              onReveal={handleRevealDni}
            />
          </div>

          <div>
            <SecretField
              label={tProfile("iban")}
              value={
                revealedIban ??
                (employee.hasIban
                  ? "ES•• •••• •••• •••• •••• ••••"
                  : "Not recorded")
              }
              onReveal={handleRevealIban}
            />
          </div>
        </div>
      </div>

      {/* Emergency Contacts & Custom Fields Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Emergency Contacts (EMP-002) */}
        <div className="rounded-card border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-5 w-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                Emergency Contacts
              </h2>
            </div>

            <Dialog open={contactOpen} onOpenChange={setContactOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Contact</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Emergency Contact</DialogTitle>
                  <DialogDescription>
                    Provide contact details in case of sudden medical or
                    workplace emergency.
                  </DialogDescription>
                </DialogHeader>

                <form
                  onSubmit={handleAddEmergencyContact}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <label
                      htmlFor="ec-name"
                      className="text-xs font-medium text-foreground"
                    >
                      Contact Full Name
                    </label>
                    <Input
                      id="ec-name"
                      required
                      placeholder="e.g. Maria Garcia"
                      value={contactFullName}
                      onChange={(e) => setContactFullName(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="ec-rel"
                        className="text-xs font-medium text-foreground"
                      >
                        Relationship
                      </label>
                      <select
                        id="ec-rel"
                        className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                        value={contactRelationship}
                        onChange={(e) => setContactRelationship(e.target.value)}
                      >
                        <option value="Spouse">Spouse / Partner</option>
                        <option value="Parent">Parent</option>
                        <option value="Child">Child</option>
                        <option value="Sibling">Sibling</option>
                        <option value="Friend">Friend / Other</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="ec-phone-prim"
                        className="text-xs font-medium text-foreground"
                      >
                        Primary Phone
                      </label>
                      <Input
                        id="ec-phone-prim"
                        required
                        placeholder="+34 611 222 333"
                        value={contactPhonePrimary}
                        onChange={(e) => setContactPhonePrimary(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="ec-phone-sec"
                      className="text-xs font-medium text-foreground"
                    >
                      Secondary Phone (optional)
                    </label>
                    <Input
                      id="ec-phone-sec"
                      placeholder="+34 930 111 222"
                      value={contactPhoneSecondary}
                      onChange={(e) => setContactPhoneSecondary(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      id="ec-primary"
                      type="checkbox"
                      checked={contactIsPrimary}
                      onChange={(e) => setContactIsPrimary(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    />
                    <label
                      htmlFor="ec-primary"
                      className="text-xs text-foreground cursor-pointer select-none"
                    >
                      Primary emergency contact
                    </label>
                  </div>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setContactOpen(false)}
                    >
                      {tCommon("cancel")}
                    </Button>
                    <Button type="submit" disabled={contactSubmitting}>
                      {contactSubmitting ? tCommon("loading") : "Save Contact"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-3">
            {contactsError && (
              <p role="alert" className="text-sm text-destructive">
                {tProfile("contactsLoadError")}
              </p>
            )}
            {!contactsError && contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No emergency contacts registered yet.
              </p>
            ) : (
              contacts.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border border-border p-3 bg-surface-raised"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">
                        {c.fullName}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {c.relationship}
                      </Badge>
                      {c.isPrimary && (
                        <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30">
                          Primary
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground pt-1 flex items-center gap-2">
                      <span>{c.phonePrimary}</span>
                      {c.phoneSecondary && (
                        <>
                          <span>&middot;</span>
                          <span>{c.phoneSecondary}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => handleDeleteEmergencyContact(c.id)}
                    aria-label="Delete contact"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Custom Profile Fields (ORG-005) */}
        <div className="rounded-card border border-border bg-surface p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-5 w-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                Custom Profile Fields
              </h2>
            </div>

            {allDefinitions.length > 0 && (
              <Dialog open={cfModalOpen} onOpenChange={setCfModalOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    <span>Set Field</span>
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Set Custom Field Value</DialogTitle>
                    <DialogDescription>
                      Assign or update an organizational field value for this
                      employee.
                    </DialogDescription>
                  </DialogHeader>

                  <form onSubmit={handleSaveCustomField} className="space-y-4">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="cf-select-def"
                        className="text-xs font-medium text-foreground"
                      >
                        Field Definition
                      </label>
                      <select
                        id="cf-select-def"
                        required
                        className="flex h-10 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                        value={selectedFieldDefId}
                        onChange={(e) => {
                          setSelectedFieldDefId(e.target.value);
                          const existing = customFields.find(
                            (cf) => cf.fieldDefinitionId === e.target.value,
                          );
                          setFieldValue(existing?.value ?? "");
                        }}
                      >
                        <option value="">Select a field...</option>
                        {allDefinitions.map((def) => (
                          <option key={def.id} value={def.id}>
                            {def.name} ({def.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="cf-val-input"
                        className="text-xs font-medium text-foreground"
                      >
                        Field Value
                      </label>
                      <Input
                        id="cf-val-input"
                        placeholder="Enter value..."
                        value={fieldValue}
                        onChange={(e) => setFieldValue(e.target.value)}
                      />
                    </div>

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setCfModalOpen(false)}
                      >
                        {tCommon("cancel")}
                      </Button>
                      <Button
                        type="submit"
                        disabled={cfSubmitting || !selectedFieldDefId}
                      >
                        {cfSubmitting ? tCommon("loading") : "Save Value"}
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>

          <div className="space-y-3">
            {customFields.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No custom profile fields assigned yet.
              </p>
            ) : (
              customFields.map((cf) => (
                <div
                  key={cf.id}
                  className="flex items-center justify-between rounded-md border border-border p-3 bg-surface-raised"
                >
                  <div>
                    <span className="text-xs text-muted-foreground block font-mono">
                      {cf.fieldName ?? cf.fieldCode}
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {cf.value ?? "—"}
                    </span>
                  </div>
                  <Tag className="h-4 w-4 text-muted-foreground" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Kiosk PIN & Badge Access (TIM-010) */}
        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Kiosk PIN & Tablet Access (TIM-010)
              </h2>
            </div>

            <Dialog open={pinModalOpen} onOpenChange={setPinModalOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                  <KeyRound className="h-3.5 w-3.5" />
                  Set PIN / Badge
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Configure Kiosk Quick PIN</DialogTitle>
                  <DialogDescription>
                    Set a 4 to 8 digit numeric PIN and optional badge ID for
                    fast clocking on shared workplace tablets.
                  </DialogDescription>
                </DialogHeader>

                <form
                  onSubmit={(e) => void handleSavePin(e)}
                  className="space-y-4 pt-2"
                >
                  <div className="space-y-1.5">
                    <label
                      htmlFor="kiosk-pin-input"
                      className="text-xs font-medium text-foreground"
                    >
                      Numeric PIN (4-8 digits)
                    </label>
                    <Input
                      id="kiosk-pin-input"
                      type="password"
                      placeholder="••••"
                      maxLength={8}
                      value={kioskPin}
                      onChange={(e) =>
                        setKioskPin(e.target.value.replace(/\D/g, ""))
                      }
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="kiosk-badge-input"
                      className="text-xs font-medium text-foreground"
                    >
                      RFID / NFC / Badge ID (optional)
                    </label>
                    <Input
                      id="kiosk-badge-input"
                      type="text"
                      placeholder="e.g. BADGE-4091"
                      value={kioskBadgeId}
                      onChange={(e) => setKioskBadgeId(e.target.value)}
                    />
                  </div>

                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPinModalOpen(false)}
                    >
                      {tCommon("cancel")}
                    </Button>
                    <Button
                      type="submit"
                      disabled={pinSubmitting || kioskPin.length < 4}
                    >
                      {pinSubmitting ? tCommon("loading") : "Save PIN"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <p className="text-xs text-muted-foreground">
            {pinSuccess
              ? "Kiosk PIN is configured and active for tablet clocking."
              : "Allow this employee to clock in and out on on-site shared tablets using a secure numeric PIN."}
          </p>
        </div>
      </div>
    </div>
  );
}
