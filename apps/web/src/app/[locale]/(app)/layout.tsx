"use client";

import * as React from "react";
import { usePathname, useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Sidebar,
  Topbar,
  BottomNav,
  Avatar,
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
import { ThemeToggle } from "../../../components/theme-toggle";
import { LanguageSwitcher } from "../../../components/language-switcher";
import { NotificationBell } from "../../../components/notification-bell";
import { ClockWidget } from "../../../components/clock-widget";
import { getStoredSession, signOut } from "@/lib/auth";
import { getApiClient } from "@/lib/api-client";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const router = useRouter();
  const tNav = useTranslations("nav");
  const tAuth = useTranslations("auth");
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } catch {
      // The local profile is cleared regardless; the cookie expires anyway.
    } finally {
      router.push(`/${locale}/sign-in`);
    }
  };

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
      icon: <IconClockIn size={16} />,
    },
    {
      href: `/${locale}/time/export`,
      label: tNav("inspectionRecords"),
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

  return (
    <div className="flex min-h-screen bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-input focus:bg-surface-raised focus:p-3 focus:text-foreground focus:ring-2 focus:ring-focus-ring"
      >
        {tNav("skipToContent")}
      </a>
      {/* Desktop Sidebar */}
      <Sidebar
        items={navItems}
        currentPath={pathname}
        orgName={orgName}
        ariaLabel={tNav("mainNavigation")}
        workspaceLabel={tNav("workspace")}
        footer={
          userName ? (
            <div className="flex items-center gap-3">
              <Avatar name={userName} size="sm" />
              <div className="flex flex-col overflow-hidden text-xs">
                <span className="truncate font-semibold text-foreground">
                  {userName}
                </span>
                {userRole && (
                  <span className="text-muted-foreground">{userRole}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={isSigningOut}
                className="ml-auto rounded-input px-2 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              >
                {tAuth("signOut")}
              </button>
            </div>
          ) : undefined
        }
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <Topbar
          actions={
            <div className="flex items-center gap-2">
              <div className="hidden sm:block">
                <ClockWidget />
              </div>
              <NotificationBell />
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          }
          userMenu={
            userName ? (
              <div className="flex items-center gap-2 md:hidden">
                <Avatar name={userName} size="sm" />
              </div>
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
  );
}
