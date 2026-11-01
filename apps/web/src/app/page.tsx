import { redirect } from "next/navigation";
import { defaultLocale } from "@openhr/i18n";

export default function RootPage() {
  redirect(`/${defaultLocale}/home`);
}
