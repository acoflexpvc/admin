import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type StatusMessage = { type: "success" | "error" | "info"; text: string };

const styles = {
  success: {
    box: "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200",
    icon: CheckCircle2,
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    box: "border-destructive/30 bg-destructive/10 text-destructive",
    icon: AlertCircle,
    iconClass: "text-destructive",
  },
  info: {
    box: "border-sky-500/30 bg-sky-500/10 text-sky-900 dark:text-sky-200",
    icon: Info,
    iconClass: "text-sky-600 dark:text-sky-400",
  },
} as const;

/** Inline success / error / info notice. Errors are announced immediately to screen readers. */
export function StatusBanner({
  message,
  onDismiss,
  className,
}: {
  message: StatusMessage | null;
  onDismiss?: () => void;
  className?: string;
}) {
  if (!message) return null;
  const style = styles[message.type];
  const Icon = style.icon;
  return (
    <div
      role={message.type === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border p-4 text-sm", style.box, className)}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", style.iconClass)} aria-hidden="true" />
      <p className="min-w-0 flex-1 font-medium break-words">{message.text}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="-m-1 shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Dismiss message"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
