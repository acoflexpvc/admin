import { CheckCircle2, Clock } from "lucide-react";

/** The three explicit editing states shared by every Save Draft / Publish screen. */
export function PublishStateBadge({
  isDirty,
  hasDraft,
  unpublishedLabel,
}: {
  isDirty: boolean;
  hasDraft: boolean;
  /** Shown instead of "Published on website" for records that were never published. */
  unpublishedLabel?: string;
}) {
  if (isDirty) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Changes not saved
      </span>
    );
  }
  if (hasDraft) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-400">
        <Clock className="size-3" aria-hidden="true" />
        Draft saved — not live yet
      </span>
    );
  }
  if (unpublishedLabel) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
        {unpublishedLabel}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="size-3" aria-hidden="true" />
      Published on website
    </span>
  );
}

/** Small "Unsaved edits" pill for a section header. */
export function UnsavedPill() {
  return (
    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      Unsaved edits
    </span>
  );
}
