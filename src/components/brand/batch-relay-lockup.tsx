import { cn } from "@/lib/cn";

export type BatchRelayLockupProps = {
  className?: string;
};

export function BatchRelayLockup({ className }: BatchRelayLockupProps) {
  return (
    <span
      aria-label="Batch Relay"
      role="img"
      className={cn(
        "block h-7 w-[138px] shrink-0 bg-foreground transition-colors duration-300 md:group-hover:bg-orange-500 md:group-focus-visible:bg-orange-500 motion-reduce:transition-none",
        className,
      )}
      style={{
        mask: "url('/branding/lockup-horizontal-espresso.svg') left center / contain no-repeat",
        WebkitMask: "url('/branding/lockup-horizontal-espresso.svg') left center / contain no-repeat",
      }}
    />
  );
}
