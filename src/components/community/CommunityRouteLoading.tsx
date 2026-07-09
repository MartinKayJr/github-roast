import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommunityRouteLoadingProps {
  variant?: "galaxy" | "reading";
}

function SkeletonPlanet({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative rounded-full border border-white/10 bg-white/[0.03] shadow-[0_0_52px_rgba(34,211,238,0.14)]",
        className,
      )}
    >
      <div className="absolute inset-[22%] rounded-full bg-cyan-300/12 blur-md" />
      <div className="absolute left-1/2 top-1/2 h-[58%] w-[118%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/15" />
    </div>
  );
}

function ReadingSkeleton() {
  return (
    <div className="mt-8 columns-1 gap-3 md:columns-2 xl:columns-3">
      {Array.from({ length: 9 }).map((_, index) => (
        <div
          key={index}
          className="mb-3 break-inside-avoid rounded-lg border border-white/10 bg-white/[0.04] p-4"
        >
          <div className="h-4 w-2/3 rounded bg-white/10" />
          <div className="mt-3 flex gap-2">
            <div className="h-5 w-14 rounded-full bg-cyan-300/12" />
            <div className="h-5 w-20 rounded-full bg-white/10" />
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-3 rounded bg-white/10" />
            <div className="h-3 w-11/12 rounded bg-white/10" />
            <div className="h-3 w-3/5 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CommunityRouteLoading({
  variant = "galaxy",
}: CommunityRouteLoadingProps) {
  const reading = variant === "reading";

  return (
    <main
      data-force-dark
      className="relative min-h-screen w-full overflow-hidden bg-[#020617] px-4 py-8 sm:px-6"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(34,211,238,0.16),transparent_30%),linear-gradient(to_bottom,rgba(2,6,23,0.1),rgba(2,6,23,0.9)_78%)]" />
      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/20 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white">
          <LoaderCircle className="h-4 w-4 animate-spin text-cyan-100" aria-hidden="true" />
          {reading ? "正在进入阅读模式..." : "正在加载圈子..."}
        </div>

        {reading ? (
          <ReadingSkeleton />
        ) : (
          <div className="relative mt-10 min-h-[58vh]">
            <SkeletonPlanet className="absolute left-[6%] top-8 h-56 w-56 sm:h-72 sm:w-72" />
            <SkeletonPlanet className="absolute left-[42%] top-32 h-44 w-44 sm:h-64 sm:w-64" />
            <SkeletonPlanet className="absolute right-[2%] top-2 h-52 w-52 sm:h-80 sm:w-80" />
          </div>
        )}
      </div>
    </main>
  );
}
