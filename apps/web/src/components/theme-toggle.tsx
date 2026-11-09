"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Sun, Moon, Laptop } from "lucide-react";
import { Button } from "@librehr/ui";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const tCommon = useTranslations("common");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="h-9 w-9" />;
  }

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycleTheme}
      aria-label={tCommon("themeToggle", {
        theme:
          theme === "light"
            ? tCommon("theme.light")
            : theme === "dark"
              ? tCommon("theme.dark")
              : tCommon("theme.system"),
      })}
      className="h-9 w-9 p-0"
    >
      {theme === "light" ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : theme === "dark" ? (
        <Moon className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Laptop className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  );
}
