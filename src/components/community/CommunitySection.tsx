"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CommunityProfile } from "@/lib/db";
import type { Lang } from "@/lib/lang";
import { CommunityProfileCard } from "./CommunityProfileCard";
import { CommunityOnboardingDialog } from "./CommunityOnboardingDialog";

interface CommunitySectionProps {
  profile: CommunityProfile | null;
  isOwner: boolean;
  hasRoast: boolean;
  username: string;
  lang: Lang;
}

/**
 * Client island for the community section on a profile page.
 * Owns dialog open/edit state so the surrounding server component stays static.
 * Both active and pre-join states share id="community" so the navbar anchor works.
 */
export function CommunitySection({
  profile,
  isOwner,
  hasRoast,
  username,
  lang,
}: CommunitySectionProps) {
  const t = useTranslations("community");
  const [dialogOpen, setDialogOpen] = useState(false);

  const isActive = profile?.status === "active";

  if (isActive) {
    return (
      <div id="community">
        <CommunityProfileCard
          profile={profile!}
          isOwner={isOwner}
          lang={lang}
          onEdit={isOwner ? () => setDialogOpen(true) : undefined}
        />
        {isOwner && (
          <CommunityOnboardingDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            username={username}
            hasRoast={hasRoast}
            initialProfile={profile}
          />
        )}
      </div>
    );
  }

  if (!isOwner) return null;

  return (
    <div id="community">
      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/[0.04] p-5 sm:p-6">
        <div className="mb-3">
          <h2 className="text-base font-bold text-emerald-200">{t("joinCta")}</h2>
          <p className="mt-1 text-sm text-zinc-400">{t("introStep.communityDesc")}</p>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          {t("introStep.continue")}
        </button>
      </div>
      <CommunityOnboardingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        username={username}
        hasRoast={hasRoast}
      />
    </div>
  );
}
