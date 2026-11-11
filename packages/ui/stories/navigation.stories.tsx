import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import { Sidebar } from "../src/components/sidebar.js";
import { BottomNav } from "../src/components/bottom-nav.js";
import { Home, Users, Calendar, Clock, FileText } from "lucide-react";

const sampleNavItems = [
  {
    href: "/home",
    label: "Home",
    icon: <Home className="h-4 w-4" />,
    isActive: true,
  },
  { href: "/people", label: "People", icon: <Users className="h-4 w-4" /> },
  {
    href: "/time-off",
    label: "Time off",
    icon: <Calendar className="h-4 w-4" />,
    badge: 2,
  },
  {
    href: "/time",
    label: "Time tracking",
    icon: <Clock className="h-4 w-4" />,
  },
  {
    href: "/documents",
    label: "Documents",
    icon: <FileText className="h-4 w-4" />,
  },
];

const meta: Meta = {
  title: "Navigation/ShellNav",
};

export default meta;

export const DesktopSidebar: StoryObj<typeof Sidebar> = {
  render: () => (
    <div className="h-[500px]">
      <Sidebar items={sampleNavItems} currentPath="/home" orgName="Acme Corp" />
    </div>
  ),
};

export const MobileBottomNav: StoryObj<typeof BottomNav> = {
  render: () => (
    <div className="relative h-[200px] border border-border">
      <BottomNav items={sampleNavItems} currentPath="/home" />
    </div>
  ),
};
