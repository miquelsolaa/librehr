import { redirect } from "next/navigation";
import { defaultLocale } from "@librehr/i18n";

export default function RootPage() {
  redirect(`/${defaultLocale}/home`);
}
