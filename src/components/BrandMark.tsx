import { cn } from "@/lib/utils";

/** Marca WLC IA: </ WLC IA /> */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center select-none font-mono font-bold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-lime-400 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(52,211,153,0.25)]",
        className
      )}
    >
      &lt;/ WLC IA /&gt;
    </span>
  );
}
