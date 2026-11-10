"use client";

import * as React from "react";
import { usePathname, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Sidebar,
  Topbar,
  BottomNav,
  LibreHRMark,
  type NavGroup,
  type NavItem,
  IconEmployees,
  IconTimeOff,
  IconClockIn,
  IconDocuments,
  IconOnboarding,
  IconReports,
  IconSettings,
} from "@librehr/ui";
import { Home, Tablet, FileText } from "lucide-react";
import { NotificationBell } from "../../../components/notification-bell";
import { ClockWidget } from "../../../components/clock-widget";
import { ClockStatusProvider } from "../../../components/clock-status-provider";
import { UserMenu } from "../../../components/user-menu";
import { getStoredSession } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";

/** Destinations about the signed-in person; the rest are organization-wide. */
const PERSONAL_PATHS = new Set(["home", "time-off", "time", "documents"]);

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const tNav = useTranslations("nav");

  const [userName, setUserName] = React.useState<string | null>(null);
  const [userRole, setUserRole] = React.useState<string | null>(null);
  const [orgName, setOrgName] = React.useState("LibreHR");

  React.useEffect(() => {
    const session = getStoredSession();
    if (!session) return;
    setUserName(session.name || session.email);
    setUserRole(session.role);
    let active = true;
    void getApiClient()
      .getOrganization()
      .then((organization) => {
        if (active) setOrgName(organization.name);
      })
      .catch(() => {
        if (active) setOrgName("LibreHR");
      });
    return () => {
      active = false;
    };
  }, []);

  const standardNavItems: NavItem[] = [
    {
      href: `/${locale}/home`,
      label: tNav("home"),
      icon: <Home className="h-4 w-4" />,
    },
    {
      href: `/${locale}/people`,
      label: tNav("people"),
      icon: <IconEmployees size={16} />,
    },
    {
      href: `/${locale}/time-off`,
      label: tNav("timeOff"),
      icon: <IconTimeOff size={16} />,
    },
    {
      href: `/${locale}/time`,
      label: tNav("time"),
      shortLabel: tNav("timeShort"),
      icon: <IconClockIn size={16} />,
    },
    {
      href: `/${locale}/kiosk`,
      label: tNav("kiosk"),
      icon: <Tablet className="h-4 w-4" />,
    },
    {
      href: `/${locale}/documents`,
      label: tNav("documents"),
      icon: <IconDocuments size={16} />,
    },
    {
      href: `/${locale}/onboarding`,
      label: tNav("onboarding"),
      icon: <IconOnboarding size={16} />,
    },
    {
      href: `/${locale}/reports`,
      label: tNav("reports"),
      icon: <IconReports size={16} />,
    },
    {
      href: `/${locale}/settings`,
      label: tNav("settings"),
      icon: <IconSettings size={16} />,
    },
  ];

  // TIM-008: Scoped navigation for read-only Labour Inspector role
  const auditorNavItems: NavItem[] = [
    {
      href: `/${locale}/home`,
      label: tNav("home"),
      icon: <Home className="h-4 w-4" />,
    },
    {
      href: `/${locale}/time`,
      label: tNav("time"),
      shortLabel: tNav("timeShort"),
      icon: <IconClockIn size={16} />,
    },
    {
      href: `/${locale}/time/export`,
      label: tNav("inspectionRecords"),
      shortLabel: tNav("inspectionRecordsShort"),
      icon: <FileText className="h-4 w-4" />,
    },
    {
      href: `/${locale}/reports`,
      label: tNav("reports"),
      icon: <IconReports size={16} />,
    },
  ];

  const employeePaths = new Set(["home", "time-off", "time", "documents"]);
  const managerPaths = new Set([
    "home",
    "people",
    "time-off",
    "time",
    "documents",
    "onboarding",
    "reports",
  ]);
  const navItems =
    userRole === "auditor"
      ? auditorNavItems
      : userRole === "admin"
        ? standardNavItems
        : standardNavItems.filter((item) => {
            const path = item.href.slice(`/${locale}/`.length);
            return userRole === "manager"
              ? managerPaths.has(path)
              : employeePaths.has(path);
          });

  const mobilePrimaryPaths =
    userRole === "auditor"
      ? ["home", "time", "time/export"]
      : ["home", "time-off", "time", "documents"];
  const mobileNavItems = mobilePrimaryPaths
    .map((path) => navItems.find((item) => item.href === `/${locale}/${path}`))
    .filter((item): item is NavItem => item !== undefined);
  const mobileOverflowItems = navItems.filter(
    (item) => !mobileNavItems.some((primary) => primary.href === item.href),
  );

  const isPersonal = (item: NavItem) =>
    PERSONAL_PATHS.has(item.href.slice(`/${locale}/`.length));
  // Auditors get one short read-only list; the sidebar drops empty groups and
  // hides the labels when only one group is left.
  const navGroups: NavGroup[] =
    userRole === "auditor"
      ? [{ label: tNav("groupMe"), items: navItems }]
      : [
          { label: tNav("groupMe"), items: navItems.filter(isPersonal) },
          {
            label: tNav("groupOrganization"),
            items: navItems.filter((item) => !isPersonal(item)),
          },
        ];

  // These pages show the full clock widget themselves; a second copy in the
  // top bar would offer the same action twice.
  const pageHasClock =
    pathname === `/${locale}/home` || pathname === `/${locale}/time`;

  return (
    <ClockStatusProvider>
      <div className="flex min-h-screen bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-input focus:bg-surface-raised focus:p-3 focus:text-foreground focus:ring-2 focus:ring-focus-ring"
        >
          {tNav("skipToContent")}
        </a>
        {/* Desktop Sidebar */}
        <Sidebar
          groups={navGroups}
          currentPath={pathname}
          orgName={orgName}
          ariaLabel={tNav("mainNavigation")}
        />

        {/* Main content area */}
        <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
          <Topbar
            brand={
              // The sidebar carries the brand on desktop.
              <a
                href={`/${locale}/home`}
                className="flex min-w-0 items-center gap-2 rounded-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring md:hidden"
              >
                <LibreHRMark
                  size={28}
                  aria-hidden="true"
                  className="shrink-0 text-primary"
                />
                <span className="truncate text-sm font-semibold text-foreground">
                  {orgName}
                </span>
              </a>
            }
            actions={
              <div className="flex items-center gap-2">
                {!pageHasClock && (
                  <div className="hidden sm:block">
                    <ClockWidget density="compact" />
                  </div>
                )}
                <NotificationBell />
              </div>
            }
            userMenu={
              userName ? (
                <UserMenu name={userName} role={userRole} />
              ) : undefined
            }
          />

          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 p-4 pb-20 md:p-8 md:pb-8 max-w-[1280px] w-full mx-auto"
          >
            {children}
          </main>

          {/* Mobile Bottom Navigation */}
          <BottomNav
            items={mobileNavItems}
            overflowItems={mobileOverflowItems}
            currentPath={pathname}
            ariaLabel={tNav("mobileNavigation")}
            moreLabel={tNav("more")}
          />
        </div>
      </div>
    </ClockStatusProvider>
  );
}
