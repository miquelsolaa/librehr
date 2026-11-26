"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getApiClient } from "@/lib/api-client";
import { setStoredSession } from "@/lib/auth";
import { AuthNotice, AuthPanel } from "@/features/auth/auth-panel";

/**
 * AUTH-004: where GET /v1/sso/callback sends the browser after a successful
 * single sign-on. The session is already in the httpOnly cookie; this page
 * caches the non-secret profile, as password sign-in does, and moves on.
 */
export default function SsoCompletePage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.["locale"] as string | undefined) ?? "ca";
  const tAuth = useTranslations("auth");
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    getApiClient()
      .getMe()
      .then(({ user }) => {
        if (!active) return;
        setStoredSession({
          userId: user.id,
          email: user.email,
          name: user.name,
          organizationId: user.organizationId,
          role: user.role,
        });
        router.replace(`/${locale}/home`);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [locale, router]);

  return (
    <AuthPanel
      title={tAuth("ssoCompleteTitle")}
      description={failed ? undefined : tAuth("ssoCompleteDescription")}
    >
      {failed && (
        <div className="space-y-4">
          <AuthNotice tone="error">{tAuth("ssoCompleteError")}</AuthNotice>
          <Link
            href={`/${locale}/sign-in`}
            className="inline-block text-sm font-medium text-primary hover:underline"
          >
            {tAuth("backToSignIn")}
          </Link>
        </div>
      )}
    </AuthPanel>
  );
}
