"use client";

import {
  ArrowLeft,
  Database,
  FileText,
  FolderSearch,
  KeyRound,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";
import { usePathname, Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/BrandMark";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

type AdminWorkspaceProps = {
  login: string;
  children: React.ReactNode;
};

const navigationGroups = [
  {
    labelKey: "navigation.workspace",
    items: [
      { href: "/admin", labelKey: "navigation.overview", icon: LayoutDashboard },
      { href: "/admin/content", labelKey: "navigation.content", icon: FileText },
    ],
  },
  {
    labelKey: "navigation.operations",
    items: [
      { href: "/admin/projects", labelKey: "navigation.projects", icon: FolderSearch },
      { href: "/admin/maintenance", labelKey: "navigation.maintenance", icon: Database },
    ],
  },
  {
    labelKey: "navigation.system",
    items: [
      { href: "/admin/integrations", labelKey: "navigation.integrations", icon: KeyRound },
    ],
  },
] as const;

function AdminNavigation({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const t = useTranslations("admin");

  return (
    <nav aria-label={t("navigationLabel")} className={compact ? "flex min-w-max gap-1" : "space-y-6"}>
      {navigationGroups.map((group) => (
        <div key={group.labelKey} className={compact ? "contents" : "space-y-1.5"}>
          {!compact && (
            <p className="px-2 text-[11px] font-semibold uppercase text-zinc-500">
              {t(group.labelKey)}
            </p>
          )}
          {group.items.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-2 rounded-lg border text-sm font-medium transition-colors ${
                  compact
                    ? `h-9 shrink-0 px-3 ${
                        active
                          ? "border-orange-300/30 bg-orange-500/10 text-orange-200"
                          : "border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      }`
                    : `w-full px-3 py-2.5 ${
                        active
                          ? "border-orange-300/30 bg-orange-500/10 text-orange-200"
                          : "border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                      }`
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AdminWorkspace({ login, children }: AdminWorkspaceProps) {
  const t = useTranslations("admin");

  return (
    <div className="flex min-h-[100dvh] w-full bg-background">
      <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r border-white/10 bg-white/[0.02] lg:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-5">
          <Link href="/admin" className="flex min-w-0 items-center gap-2.5 text-zinc-100">
            <BrandMark className="size-6 shrink-0" />
            <span className="truncate text-base font-black">ghsphere</span>
            <span className="rounded-md border border-orange-300/20 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-200">
              {t("workspaceBadge")}
            </span>
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
          <AdminNavigation />
        </div>

        <div className="space-y-3 border-t border-white/10 p-3">
          <div className="flex items-center gap-2 px-2 py-1 text-sm text-zinc-400">
            <ShieldCheck className="h-4 w-4 shrink-0 text-orange-400" aria-hidden="true" />
            <span className="truncate">@{login}</span>
          </div>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>{t("returnToSite")}</span>
          </Link>
          <div className="flex items-center justify-between gap-2 px-1">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-background/95 backdrop-blur lg:hidden">
          <div className="flex h-14 items-center justify-between gap-3 px-4">
            <Link href="/admin" className="flex min-w-0 items-center gap-2 text-zinc-100">
              <BrandMark className="size-5 shrink-0" />
              <span className="truncate text-sm font-black">ghsphere</span>
              <span className="text-xs font-semibold text-orange-400">{t("workspaceBadge")}</span>
            </Link>
            <div className="flex shrink-0 items-center gap-2">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          </div>
          <div className="overflow-x-auto border-t border-white/10 px-3 py-2">
            <AdminNavigation compact />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
