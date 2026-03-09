import { ChevronUpIcon } from "lucide-react";
import { memo, useState } from "react";
import type { RateLimitWindow } from "../wsNativeApi";
import { useRateLimits } from "../rateLimitsStore";
import { OpenAI } from "./Icons";

function formatResetsAt(resetsAt: number | undefined): string | null {
  if (!resetsAt) return null;
  const now = Date.now() / 1000;
  const diff = resetsAt - now;
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${Math.ceil(diff / 60)}m`;
}

function LimitBar({
  label,
  window,
}: {
  label: string;
  window: RateLimitWindow;
}) {
  const usedPercent = Math.min(100, Math.max(0, window.usedPercent ?? 0));
  const remainingPercent = 100 - usedPercent;
  const resetsIn = formatResetsAt(window.resetsAt);

  return (
    <div className="group/bar flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground/70">
        <OpenAI className="size-3 shrink-0" />
        {label}
      </span>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/40">
        <div
          className="h-full rounded-full bg-ring/50 transition-all duration-500"
          style={{ width: `${usedPercent}%` }}
        />
      </div>
      <div className="flex items-center">
        <span className="text-[10px] tabular-nums text-muted-foreground/50">
          {remainingPercent}% left
        </span>
        {resetsIn && (
          <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/40 opacity-0 transition-opacity group-hover/bar:opacity-100">
            resets in {resetsIn}
          </span>
        )}
      </div>
    </div>
  );
}

export const WeeklyLimitPill = memo(function WeeklyLimitPill() {
  const rateLimits = useRateLimits();
  const [expanded, setExpanded] = useState(false);

  const primary = rateLimits?.rateLimits?.primary;
  const secondary = rateLimits?.rateLimits?.secondary;

  const hasSecondary =
    secondary != null && secondary.usedPercent !== undefined;
  const hasPrimary = primary != null && primary.usedPercent !== undefined;

  if (!hasPrimary && !hasSecondary) return null;

  return (
    <div className="flex flex-col rounded-lg border border-border/50 px-2.5 py-1.5">
      {hasSecondary && hasPrimary && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-in-out"
          style={{
            gridTemplateRows: expanded ? "1fr" : "0fr",
            opacity: expanded ? 1 : 0,
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="pb-2 mb-2 border-b border-border/30">
              <LimitBar label="Weekly Usage" window={primary} />
            </div>
          </div>
        </div>
      )}

      {hasSecondary ? (
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <LimitBar label="Session Usage" window={secondary} />
          </div>
          {hasPrimary && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground/70"
              title={expanded ? "Hide weekly usage" : "Show weekly usage"}
            >
              <ChevronUpIcon
                className={`size-3 transition-transform duration-300 ease-in-out ${expanded ? "" : "rotate-180"}`}
              />
            </button>
          )}
        </div>
      ) : (
        hasPrimary && <LimitBar label="Weekly Usage" window={primary} />
      )}
    </div>
  );
});
