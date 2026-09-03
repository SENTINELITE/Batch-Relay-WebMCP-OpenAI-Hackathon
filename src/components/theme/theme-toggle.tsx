"use client";

import { useThemePreference } from "@/components/theme/theme-provider";
import { cn } from "@/lib/cn";

const iconProps = {
  "aria-hidden": true as const,
  fill: "none" as const,
  stroke: "currentColor" as const,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.7,
  viewBox: "0 0 24 24" as const,
};

function SunIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setPreference } = useThemePreference();

  return (
    <button
      aria-label="Switch color mode"
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full border border-border bg-card text-primary transition-[background-color,border-color,color,transform] duration-200 ease-[var(--ease-out-expo)] hover:bg-surface-warm active:scale-[0.96] motion-reduce:transition-none",
        className,
      )}
      onClick={() => setPreference(resolvedTheme === "dark" ? "light" : "dark")}
      title="Switch color mode"
      type="button"
    >
      <span className="relative grid size-[18px] place-items-center">
        <SunIcon className="absolute size-[18px] rotate-0 scale-100 opacity-100 transition-[opacity,transform] duration-300 ease-[var(--ease-out-expo)] motion-reduce:transition-none dark:rotate-90 dark:scale-50 dark:opacity-0" />
        <MoonIcon className="absolute size-[18px] -rotate-90 scale-50 opacity-0 transition-[opacity,transform] duration-300 ease-[var(--ease-out-expo)] motion-reduce:transition-none dark:rotate-0 dark:scale-100 dark:opacity-100" />
      </span>
    </button>
  );
}
