"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { CommunityProfile } from "@/lib/db";

interface CommunityOnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
  hasRoast: boolean;
  initialProfile?: CommunityProfile | null;
}

type Step = "intro" | "form" | "confirm";

interface BilingualField {
  zh: string;
  en: string;
}

interface FormData {
  working_on: BilingualField;
  want_to_meet: BilingualField;
  contact_method: BilingualField;
  chat_topics: BilingualField;
  no_recommend_for: BilingualField;
}

const PROFILE_FIELDS = [
  "working_on",
  "want_to_meet",
  "contact_method",
  "chat_topics",
  "no_recommend_for",
] as const;

const FIELD_LABEL_KEYS: Record<
  (typeof PROFILE_FIELDS)[number],
  { label: string; placeholder: string }
> = {
  working_on: { label: "workingOn", placeholder: "workingOnPlaceholder" },
  want_to_meet: { label: "wantToMeet", placeholder: "wantToMeetPlaceholder" },
  contact_method: { label: "contactMethod", placeholder: "contactMethodPlaceholder" },
  chat_topics: { label: "chatTopics", placeholder: "chatTopicsPlaceholder" },
  no_recommend_for: { label: "noRecommend", placeholder: "noRecommendPlaceholder" },
};

type ProfileField = (typeof PROFILE_FIELDS)[number];

interface QuickOption {
  key: string;
  value: BilingualField;
}

const QUICK_OPTIONS: Record<ProfileField, QuickOption[]> = {
  working_on: [
    { key: "openSource", value: { zh: "开源项目与长期维护", en: "open-source projects and long-term maintenance" } },
    { key: "aiApps", value: { zh: "AI 应用与开发者工具", en: "AI apps and developer tools" } },
    { key: "frontend", value: { zh: "前端体验与产品工程", en: "frontend experience and product engineering" } },
    { key: "infra", value: { zh: "基础设施、系统与工程效率", en: "infrastructure, systems, and engineering productivity" } },
  ],
  want_to_meet: [
    { key: "collaborators", value: { zh: "能一起认真做项目的开源伙伴", en: "open-source collaborators who ship serious projects" } },
    { key: "sameStack", value: { zh: "技术栈相近的开发者", en: "developers with a similar stack" } },
    { key: "builders", value: { zh: "正在做产品或工具的独立开发者", en: "indie builders working on products or tools" } },
    { key: "maintainers", value: { zh: "关注长期维护的项目作者", en: "maintainers who care about long-term quality" } },
  ],
  contact_method: [
    { key: "github", value: { zh: "GitHub 主页、Issue 或公开讨论", en: "GitHub profile, issues, or public discussions" } },
    { key: "specific", value: { zh: "欢迎带具体项目或问题来聊", en: "happy to chat when there is a concrete project or question" } },
    { key: "async", value: { zh: "偏好异步沟通", en: "async communication preferred" } },
  ],
  chat_topics: [
    { key: "architecture", value: { zh: "项目架构与工程取舍", en: "project architecture and engineering tradeoffs" } },
    { key: "opensource", value: { zh: "开源协作、文档和维护", en: "open-source collaboration, docs, and maintenance" } },
    { key: "ai", value: { zh: "AI 应用落地与工具链", en: "AI application engineering and tooling" } },
    { key: "quality", value: { zh: "代码质量、测试和性能", en: "code quality, testing, and performance" } },
  ],
  no_recommend_for: [
    { key: "spam", value: { zh: "无上下文私信或批量推销", en: "context-free DMs or bulk sales outreach" } },
    { key: "recruiting", value: { zh: "纯招聘或外包转发", en: "generic recruiting or outsourcing blasts" } },
    { key: "unrelated", value: { zh: "与公开项目无关的请求", en: "requests unrelated to public projects" } },
  ],
};

function profileToFormData(profile: CommunityProfile | null | undefined): FormData {
  return {
    working_on: profile?.working_on ?? { zh: "", en: "" },
    want_to_meet: profile?.want_to_meet ?? { zh: "", en: "" },
    contact_method: profile?.contact_method ?? { zh: "", en: "" },
    chat_topics: profile?.chat_topics ?? { zh: "", en: "" },
    no_recommend_for: profile?.no_recommend_for ?? { zh: "", en: "" },
  };
}

export function CommunityOnboardingDialog({
  open,
  onOpenChange,
  username,
  hasRoast,
  initialProfile,
}: CommunityOnboardingDialogProps) {
  const t = useTranslations("community");
  const router = useRouter();
  const isEdit = initialProfile?.status === "active";
  const [step, setStep] = useState<Step>(isEdit ? "form" : "intro");
  const [currentLang, setCurrentLang] = useState<"zh" | "en">("zh");
  const [visibility, setVisibility] = useState<"public" | "private">(
    initialProfile?.visibility ?? "public",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormData>(() => profileToFormData(initialProfile));

  const updateField = (field: keyof FormData, lang: "zh" | "en", value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        [lang]: value,
      },
    }));
  };

  const mergeOption = (current: string, next: string) => {
    if (!current.trim()) return next;
    if (current.includes(next)) return current;
    return `${current.trim()} / ${next}`;
  };

  const applyQuickOption = (field: ProfileField, option: QuickOption) => {
    setFormData((prev) => ({
      ...prev,
      [field]: {
        zh: mergeOption(prev[field].zh, option.value.zh),
        en: mergeOption(prev[field].en, option.value.en),
      },
    }));
  };

  const handleAiGenerate = async () => {
    setAiLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/community/profile/ai", { method: "POST" });
      if (!response.ok) {
        throw new Error(t("profileForm.aiFailed"));
      }
      const data = (await response.json()) as { profile?: Partial<FormData> };
      if (!data.profile) throw new Error(t("profileForm.aiFailed"));
      setFormData((prev) => ({
        working_on: data.profile?.working_on ?? prev.working_on,
        want_to_meet: data.profile?.want_to_meet ?? prev.want_to_meet,
        contact_method: data.profile?.contact_method ?? prev.contact_method,
        chat_topics: data.profile?.chat_topics ?? prev.chat_topics,
        no_recommend_for: data.profile?.no_recommend_for ?? prev.no_recommend_for,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("profileForm.aiFailed"));
    } finally {
      setAiLoading(false);
    }
  };

  const handleContinueFromIntro = () => {
    if (!hasRoast) {
      router.push("/");
      onOpenChange(false);
      return;
    }
    setStep("form");
  };

  const handleContinueFromForm = async () => {
    setLoading(true);
    setError(null);

    try {
      // Save profile data
      const response = await fetch("/api/community/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        throw new Error(t("errors.updateFailed"));
      }

      setStep("confirm");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.updateFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!confirmed) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/community/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, visibility }),
      });

      if (!response.ok) {
        throw new Error(t("errors.optInFailed"));
      }

      onOpenChange(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.optInFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (step === "form") {
      setStep("intro");
    } else if (step === "confirm") {
      setStep("form");
    }
  };

  const isFormValid = () => {
    return (
      formData.working_on.zh.trim() !== "" &&
      formData.working_on.en.trim() !== "" &&
      formData.want_to_meet.zh.trim() !== "" &&
      formData.want_to_meet.en.trim() !== ""
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        {step === "intro" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">{t("introStep.title")}</DialogTitle>
              <DialogDescription>@{username} · {t("introStep.subtitle")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-100 mb-2">
                  {t("introStep.whatIsCommunity")}
                </h3>
                <p className="text-sm text-zinc-400">{t("introStep.communityDesc")}</p>
              </div>

              <Separator className="bg-white/10" />

              <div>
                <h3 className="text-base font-semibold text-zinc-100 mb-2">
                  {t("introStep.privacy")}
                </h3>
                <p className="text-sm text-zinc-400">{t("introStep.privacyDesc")}</p>
              </div>

              {!hasRoast && (
                <>
                  <Separator className="bg-white/10" />
                  <div className="rounded-lg border border-orange-400/25 bg-orange-500/[0.05] p-4">
                    <h3 className="text-base font-semibold text-orange-300 mb-2">
                      {t("noRoastYet")}
                    </h3>
                    <p className="text-sm text-zinc-400 mb-3">{t("noRoastYetDesc")}</p>
                    <Button
                      onClick={handleContinueFromIntro}
                      className="bg-orange-500 hover:bg-orange-600"
                    >
                      {t("goToRoast")}
                    </Button>
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button
                onClick={handleContinueFromIntro}
                disabled={!hasRoast}
                className="bg-emerald-500 hover:bg-emerald-600"
              >
                {t("introStep.continue")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "form" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">{t("profileForm.title")}</DialogTitle>
              <DialogDescription>{t("profileForm.subtitle")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentLang("zh")}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      currentLang === "zh"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {t("profileForm.chinese")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentLang("en")}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      currentLang === "en"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-white/5 text-zinc-400 hover:bg-white/10"
                    }`}
                  >
                    {t("profileForm.english")}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAiGenerate}
                  disabled={aiLoading || loading}
                  className="border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                >
                  {aiLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {aiLoading ? t("profileForm.aiGenerating") : t("profileForm.aiGenerate")}
                </Button>
              </div>

              {PROFILE_FIELDS.map(
                (field) => (
                  <div key={field} className="space-y-2">
                    <Label htmlFor={`${field}-${currentLang}`}>
                      {t(`profileForm.${FIELD_LABEL_KEYS[field].label}`)}
                      {(field === "working_on" || field === "want_to_meet") && (
                        <span className="text-orange-400 ml-1">*</span>
                      )}
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {QUICK_OPTIONS[field].map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => applyQuickOption(field, option)}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/10 hover:text-emerald-200"
                        >
                          {option.value[currentLang]}
                        </button>
                      ))}
                    </div>
                    <textarea
                      id={`${field}-${currentLang}`}
                      value={formData[field][currentLang]}
                      onChange={(e) => updateField(field, currentLang, e.target.value)}
                      placeholder={t(`profileForm.${FIELD_LABEL_KEYS[field].placeholder}`)}
                      maxLength={500}
                      rows={field === "contact_method" ? 3 : 4}
                      className="flex min-h-24 w-full resize-y rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-zinc-600 focus:border-emerald-400/60 focus-visible:ring-2 focus-visible:ring-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-xs text-zinc-500">
                      {t("profileForm.charLimit", { max: 500 })} (
                      {formData[field][currentLang].length}/500)
                    </p>
                  </div>
                ),
              )}

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-400/25 p-3">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </div>

            <DialogFooter className="flex justify-between">
              <Button variant="ghost" onClick={handleBack}>
                {t("profileForm.back")}
              </Button>
              <Button
                onClick={handleContinueFromForm}
                disabled={!isFormValid() || loading}
                className="bg-emerald-500 hover:bg-emerald-600"
              >
                {loading ? "..." : t("profileForm.continue")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl">{t("confirmStep.title")}</DialogTitle>
              <DialogDescription>{t("confirmStep.subtitle")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-100 mb-3">
                  {t("confirmStep.visibilityTitle")}
                </h3>
                <div className="space-y-2">
                  <button
                    onClick={() => setVisibility("public")}
                    className={`w-full text-left rounded-lg border p-4 transition-colors ${
                      visibility === "public"
                        ? "border-emerald-400/50 bg-emerald-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                          visibility === "public"
                            ? "border-emerald-400"
                            : "border-zinc-400"
                        }`}
                      >
                        {visibility === "public" && (
                          <div className="h-2 w-2 rounded-full bg-emerald-400" />
                        )}
                      </div>
                      <span className="font-semibold text-zinc-100">
                        {t("confirmStep.visibilityPublic")}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-400 ml-6">
                      {t("confirmStep.visibilityPublicDesc")}
                    </p>
                  </button>

                  <button
                    onClick={() => setVisibility("private")}
                    className={`w-full text-left rounded-lg border p-4 transition-colors ${
                      visibility === "private"
                        ? "border-emerald-400/50 bg-emerald-500/10"
                        : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                          visibility === "private"
                            ? "border-emerald-400"
                            : "border-zinc-400"
                        }`}
                      >
                        {visibility === "private" && (
                          <div className="h-2 w-2 rounded-full bg-emerald-400" />
                        )}
                      </div>
                      <span className="font-semibold text-zinc-100">
                        {t("confirmStep.visibilityPrivate")}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-400 ml-6">
                      {t("confirmStep.visibilityPrivateDesc")}
                    </p>
                  </button>
                </div>
              </div>

              <Separator className="bg-white/10" />

              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id="confirm-checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/15 bg-white/5"
                />
                <label htmlFor="confirm-checkbox" className="text-sm text-zinc-300">
                  {t("confirmStep.confirmCheckbox")}
                </label>
              </div>

              {error && (
                <div className="rounded-lg bg-red-500/10 border border-red-400/25 p-3">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </div>

            <DialogFooter className="flex justify-between">
              <Button variant="ghost" onClick={handleBack}>
                {t("confirmStep.back")}
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!confirmed || loading}
                className="bg-emerald-500 hover:bg-emerald-600"
              >
                {loading ? "..." : t("confirmStep.confirm")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
