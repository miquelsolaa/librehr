"use client";

import * as React from "react";
import { usePathname, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sidebar, Topbar, BottomNav, Avatar, type NavItem } from "@openhr/ui";
import {
  Home,
  Users,
  Calendar,
  Clock,
  FileText,
  UserCheck,
  BarChart3,
  Settings,
} from "lucide-react";
import { ThemeToggle } from "../../../components/theme-toggle";
import { LanguageSwitcher } from "../../../components/language-switcher";
import { getStoredSession } from "@/lib/auth";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";

  const tNav = useTranslations("nav");

  const [userName, setUserName] = React.useState<string>("Admin");

  React.useEffect(() => {
    const session = getStoredSession();
    if (session?.name) {
      setUserName(session.name);
    }
  }, []);

  const navItems: NavItem[] = [
    {
      href: `/${locale}/home`,
      label: tNav("home"),
      icon: <Home className="h-4 w-4" />,
    },
    {
      href: `/${locale}/people`,
      label: tNav("people"),
      icon: <Users className="h-4 w-4" />,
    },
    {
      href: `/${locale}/time-off`,
      label: tNav("timeOff"),
      icon: <Calendar className="h-4 w-4" />,
    },
    {
      href: `/${locale}/time`,
      label: tNav("time"),
      icon: <Clock className="h-4 w-4" />,
    },
    {
      href: `/${locale}/documents`,
      label: tNav("documents"),
      icon: <FileText className="h-4 w-4" />,
    },
    {
      href: `/${locale}/onboarding`,
      label: tNav("onboarding"),
      icon: <UserCheck className="h-4 w-4" />,
    },
    {
      href: `/${locale}/reports`,
      label: tNav("reports"),
      icon: <BarChart3 className="h-4 w-4" />,
    },
    {
      href: `/${locale}/settings`,
      label: tNav("settings"),
      icon: <Settings className="h-4 w-4" />,
    },
  ];

  // Mobile navigation only displays 5 key actions per DESIGN.md
  const mobileNavItems: NavItem[] = [
    navItems[0]!,
    navItems[2]!,
    navItems[3]!,
    navItems[4]!,
    navItems[7]!,
  ];

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <Sidebar
        items={navItems}
        currentPath={pathname}
        orgName="OpenHR Corp"
        footer={
          <div className="flex items-center gap-3">
            <Avatar name={userName} size="sm" />
            <div className="flex flex-col overflow-hidden text-xs">
              <span className="truncate font-semibold text-foreground">
                {userName}
              </span>
              <span className="text-muted-foreground">Admin</span>
            </div>
          </div>
        }
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <Topbar
          actions={
            <div className="flex items-center gap-2">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          }
          userMenu={
            <div className="flex items-center gap-2 md:hidden">
              <Avatar name={userName} size="sm" />
            </div>
          }
        />

        <main className="flex-1 p-4 pb-20 md:p-8 md:pb-8 max-w-[1280px] w-full mx-auto">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <BottomNav items={mobileNavItems} currentPath={pathname} />
      </div>
    </div>
  );
}
