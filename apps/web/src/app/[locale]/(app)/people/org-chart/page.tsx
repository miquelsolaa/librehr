"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Users,
  Search,
  ChevronRight,
  ChevronDown,
  Building2,
  MapPin,
  GitFork,
  ArrowLeft,
} from "lucide-react";
import { Input, Badge } from "@librehr/ui";
import { apiClient } from "../../../../../lib/api-client.js";
import type { OrgChartNode } from "@librehr/contracts";

interface OrgNodeCardProps {
  node: OrgChartNode;
  locale: string;
  search: string;
}

function OrgNodeCard({ node, locale, search }: OrgNodeCardProps) {
  const [expanded, setExpanded] = React.useState(true);
  const hasReports = node.directReports && node.directReports.length > 0;

  const matchesSearch =
    search.trim() !== "" &&
    (node.name.toLowerCase().includes(search.toLowerCase()) ||
      (node.jobTitle &&
        node.jobTitle.toLowerCase().includes(search.toLowerCase())) ||
      (node.departmentName &&
        node.departmentName.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="flex flex-col items-center">
      {/* Node Card */}
      <div
        className={`group relative flex flex-col rounded-card border bg-surface p-4 shadow-sm transition-all hover:border-primary/60 hover:shadow-md w-72 ${
          matchesSearch
            ? "border-primary ring-2 ring-primary/20 bg-primary/5"
            : "border-border"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary shrink-0">
              {node.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <Link
                href={`/${locale}/people/${node.id}`}
                className="font-semibold text-foreground hover:text-primary transition-colors text-sm truncate block"
              >
                {node.preferredName
                  ? `${node.preferredName} (${node.name})`
                  : node.name}
              </Link>
              <div className="text-xs text-muted-foreground truncate">
                {node.jobTitle ?? "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-border/50 text-[11px] text-muted-foreground">
          {node.departmentName && (
            <span className="flex items-center gap-1 bg-surface-raised px-1.5 py-0.5 rounded">
              <Building2 className="h-3 w-3" />
              <span className="truncate max-w-[120px]">
                {node.departmentName}
              </span>
            </span>
          )}
          {node.locationName && (
            <span className="flex items-center gap-1 bg-surface-raised px-1.5 py-0.5 rounded">
              <MapPin className="h-3 w-3" />
              <span className="truncate max-w-[100px]">
                {node.locationName}
              </span>
            </span>
          )}
        </div>

        {/* Team stats badge & expand toggle */}
        {hasReports && (
          <div className="mt-3 flex items-center justify-between pt-1">
            <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0">
              <GitFork className="h-3 w-3" />
              <span>
                {node.directReportsCount} direct &middot; {node.totalTeamCount}{" "}
                total
              </span>
            </Badge>

            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-primary font-medium hover:underline p-1"
              aria-label={expanded ? "Collapse subtree" : "Expand subtree"}
            >
              {expanded ? (
                <>
                  <span>Hide</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  <span>Show</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Children branches */}
      {hasReports && expanded && (
        <div className="flex flex-col items-center">
          {/* Vertical line down from parent */}
          <div className="h-6 w-0.5 bg-border" />

          {/* Children container with connecting horizontal line */}
          <div className="flex items-start justify-center gap-8 relative pt-2">
            {node.directReports.map((child, idx) => (
              <div
                key={child.id}
                className="flex flex-col items-center relative"
              >
                {/* Horizontal branch connection */}
                {node.directReports.length > 1 && (
                  <div
                    className={`absolute top-0 h-0.5 bg-border ${
                      idx === 0
                        ? "left-1/2 right-0"
                        : idx === node.directReports.length - 1
                          ? "left-0 right-1/2"
                          : "left-0 right-0"
                    }`}
                  />
                )}
                {/* Vertical drop line into child */}
                <div className="h-4 w-0.5 bg-border" />
                <OrgNodeCard node={child} locale={locale} search={search} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrgChartPage() {
  const params = useParams();
  const locale = (params?.["locale"] as string) ?? "es";
  const tPeople = useTranslations("people");
  const tCommon = useTranslations("common");

  const [roots, setRoots] = React.useState<OrgChartNode[]>([]);
  const [totalEmployees, setTotalEmployees] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");

  const loadOrgChart = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.getOrgChart();
      setRoots(res.roots);
      setTotalEmployees(res.totalEmployees);
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadOrgChart();
  }, [loadOrgChart]);

  return (
    <div className="space-y-6">
      {/* Header with Navigation Tabs */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              href={`/${locale}/people`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>{tPeople("title")}</span>
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span>Organizational Chart</span>
            <Badge variant="outline" className="text-xs">
              {totalEmployees} Employees
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            Interactive reporting lines, team sizes, and department hierarchies.
          </p>
        </div>

        {/* Tab switch between directory and org-chart */}
        <div className="flex items-center rounded-btn border border-border bg-surface p-1">
          <Link
            href={`/${locale}/people`}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Directory
          </Link>
          <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm">
            Org Chart
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, title, or department..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="rounded-card border border-border bg-surface/50 p-8 min-h-[500px] overflow-x-auto">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            {tCommon("loading")}
          </div>
        ) : roots.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Users className="h-10 w-10 text-muted-foreground/60" />
            <p className="text-sm">No reporting hierarchy configured yet.</p>
          </div>
        ) : (
          <div className="flex items-start justify-center gap-12 min-w-max pb-12">
            {roots.map((root) => (
              <OrgNodeCard
                key={root.id}
                node={root}
                locale={locale}
                search={search}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
