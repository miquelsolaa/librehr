"use client";

import * as React from "react";

/**
 * Accessible labels rendered by the design-system components themselves
 * (close buttons, copy buttons, landmarks). `@librehr/ui` must not depend on
 * `@librehr/i18n`, so the app passes translated strings once through
 * `UiStringsProvider`. The English defaults only apply where no provider is
 * mounted (Storybook, isolated tests).
 */
export interface UiStrings {
  close: string;
  confirm: string;
  cancel: string;
  /** Prompt above the confirmation input; `{word}` is replaced by the word. */
  typeToConfirm: string;
  dismiss: string;
  breadcrumb: string;
  copyToClipboard: string;
  copiedToClipboard: string;
  revealSecret: string;
  hideSecret: string;
}

export const defaultUiStrings: UiStrings = {
  close: "Close",
  confirm: "Confirm",
  cancel: "Cancel",
  typeToConfirm: "Type {word} to confirm:",
  dismiss: "Dismiss",
  breadcrumb: "Breadcrumb",
  copyToClipboard: "Copy to clipboard",
  copiedToClipboard: "Copied to clipboard",
  revealSecret: "Reveal secret value",
  hideSecret: "Hide secret value",
};

const UiStringsContext = React.createContext<UiStrings>(defaultUiStrings);

export function UiStringsProvider({
  strings,
  children,
}: {
  strings: UiStrings;
  children: React.ReactNode;
}) {
  return (
    <UiStringsContext.Provider value={strings}>
      {children}
    </UiStringsContext.Provider>
  );
}

export function useUiStrings(): UiStrings {
  return React.useContext(UiStringsContext);
}
