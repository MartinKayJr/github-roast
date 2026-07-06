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
    <section className="fixed right-4 top-20 z-40 sm:right-6">
      {!authConfigured ? (
        <Button
          disabled
          size="icon"
          shape="pill"
          aria-label={t("authUnavailable")}
          className="h-11 w-11 border border-white/10 bg-slate-950/60 text-zinc-400 shadow-[0_0_34px_-14px_rgba(34,211,238,0.8)] backdrop-blur-xl"
        >
          <UserPlus className="h-4 w-4" />
        </Button>
      ) : !username ? (
        <Button
          type="button"
          size="icon"
          shape="pill"
          aria-label={t("signInToJoin")}
          onClick={() => signIn("github")}
          className="h-11 w-11 border border-cyan-200/25 bg-cyan-400/15 text-cyan-100 shadow-[0_0_38px_-10px_rgba(34,211,238,0.9)] backdrop-blur-xl hover:bg-cyan-400/25"
        >
          <UserPlus className="h-4 w-4" />
        </Button>
      ) : !hasRoast ? (
        <Button
          asChild
          size="icon"
          shape="pill"
          aria-label={t("roastToJoin")}
          className="h-11 w-11 border border-orange-200/25 bg-orange-400/15 text-orange-100 shadow-[0_0_38px_-10px_rgba(251,146,60,0.9)] backdrop-blur-xl hover:bg-orange-400/25"
        >
          <Link href={`/?username=${encodeURIComponent(`https://github.com/${username}`)}`}>
            <Sparkles className="h-4 w-4" />
          </Link>
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          shape="pill"
          aria-label={isActive ? t("editProfile") : t("joinButton")}
          onClick={() => setOpen(true)}
          className="h-11 w-11 border border-cyan-200/25 bg-cyan-400/15 text-cyan-100 shadow-[0_0_38px_-10px_rgba(34,211,238,0.9)] backdrop-blur-xl hover:bg-cyan-400/25"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      )}

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
