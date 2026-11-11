import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { UiStringsProvider } from "@librehr/ui/components/ui-strings";
import { ThemeProvider } from "../../components/theme-provider";

// Bundled and served from our own origin: no third-party font request.
import "@fontsource-variable/inter";
import "../globals.css";

const ogLocales: Record<string, string> = {
  ca: "ca_ES",
  es: "es_ES",
  en: "en_US",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  const description = t("description");

  return {
    metadataBase: new URL(process.env["APP_URL"] ?? "http://localhost:3000"),
    title: "LibreHR",
    description,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      ],
      apple: [
        { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      ],
    },
    openGraph: {
      title: "LibreHR",
      description,
      url: "https://github.com/miquelsolaa/librehr",
      siteName: "LibreHR",
      images: [
        {
          url: "/og-image.png",
          width: 1200,
          height: 630,
          alt: t("ogImageAlt"),
        },
      ],
      locale: ogLocales[locale] ?? "en_US",
      type: "website",
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages();
  const t = await getTranslations({ locale });
  // Labels rendered inside @librehr/ui components (close buttons, landmarks).
  const uiStrings = {
    close: t("common.close"),
    confirm: t("common.confirm"),
    cancel: t("common.cancel"),
    // Raw: the component splits on the {word} placeholder itself.
    typeToConfirm: t.raw("ui.typeToConfirm") as string,
    dismiss: t("ui.dismiss"),
    breadcrumb: t("ui.breadcrumb"),
    copyToClipboard: t("ui.copyToClipboard"),
    copiedToClipboard: t("ui.copiedToClipboard"),
    revealSecret: t("ui.revealSecret"),
    hideSecret: t("ui.hideSecret"),
  };

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NextIntlClientProvider messages={messages} locale={locale}>
            <UiStringsProvider strings={uiStrings}>
              {children}
            </UiStringsProvider>
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
