"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Sparkles, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import type { CommunityProfile } from "@/lib/db";
import { CommunityOnboardingDialog } from "./CommunityOnboardingDialog";

interface CommunityJoinEntryProps {
  username: string | null;
  hasRoast: boolean;
  authConfigured: boolean;
  initialProfile: CommunityProfile | null;
}

export function CommunityJoinEntry({
  username,
  hasRoast,
  authConfigured,
  initialProfile,
}: CommunityJoinEntryProps) {
  const t = useTranslations("communityPage");
  const [open, setOpen] = useState(false);
  const isActive = initialProfile?.status === "active";

  return (
    <section className="mb-8 rounded-2xl border border-emerald-300/20 bg-emerald-500/[0.04] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-emerald-200">{t("joinTitle")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            {isActive ? t("joinedDesc") : t("joinDesc")}
          </p>
        </div>

        {!authConfigured ? (
          <Button disabled className="shrink-0 bg-zinc-700 text-zinc-300">
            {t("authUnavailable")}
          </Button>
        ) : !username ? (
          <Button
            type="button"
            onClick={() => signIn("github")}
            className="shrink-0 bg-emerald-500 text-white hover:bg-emerald-600"
          >
            <UserPlus className="h-4 w-4" />
            {t("signInToJoin")}
          </Button>
        ) : !hasRoast ? (
          <Button asChild className="shrink-0 bg-orange-500 text-white hover:bg-orange-600">
            <Link href={`/?username=${encodeURIComponent(`https://github.com/${username}`)}`}>
              {t("roastToJoin")}
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 bg-emerald-500 text-white hover:bg-emerald-600"
          >
            <Sparkles className="h-4 w-4" />
            {isActive ? t("editProfile") : t("joinButton")}
          </Button>
        )}
      </div>

      {username && hasRoast && (
        <CommunityOnboardingDialog
          open={open}
          onOpenChange={setOpen}
          username={username}
          hasRoast={hasRoast}
          initialProfile={initialProfile}
        />
      )}
    </section>
  );
}
