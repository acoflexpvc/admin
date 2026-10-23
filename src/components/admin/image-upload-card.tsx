import { useEffect, useId, useRef, useState } from "react";
import { ImageIcon, ImagePlus, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  HERO_IMAGE_RULES,
  HeroImageError,
  formatBytes,
  uploadHeroImage,
  type HeroImageKind,
  type UploadStage,
  type UploadedHeroImage,
} from "@/lib/hero-image";

const STAGE_TEXT: Record<UploadStage, string> = {
  checking: "Checking image…",
  optimising: "Optimising for the web…",
  uploading: "Uploading…",
  verifying: "Verifying on the server…",
};

interface FileDetails {
  name: string;
  width: number;
  height: number;
  size?: number;
}

/**
 * One banner image slot: preview, plain-language requirements, a single
 * clearly labelled button that opens the file picker, progress and errors.
 * Only the button opens the picker — clicking elsewhere on the card does not.
 */
export function ImageUploadCard({
  kind,
  value,
  optional = false,
  disabled = false,
  onUploaded,
  onRemove,
  onBusyChange,
}: {
  kind: HeroImageKind;
  value: string | null;
  optional?: boolean;
  disabled?: boolean;
  onUploaded: (image: UploadedHeroImage) => void;
  /** Shown as a Remove button when provided and an image exists. */
  onRemove?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const rules = HERO_IMAGE_RULES[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const titleId = useId();
  const rulesId = useId();
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<FileDetails | null>(null);

  // Uploads take seconds; always report to the latest callback.
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const busy = stage !== null;
  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleFile = async (file: File) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    try {
      const uploaded = await uploadHeroImage(
        file,
        kind,
        (next) => !controller.signal.aborted && setStage(next),
        controller.signal,
      );
      setDetails({
        name: file.name,
        width: uploaded.width,
        height: uploaded.height,
        size: uploaded.size,
      });
      onUploadedRef.current(uploaded);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(
        err instanceof HeroImageError || err instanceof Error
          ? err.message
          : "The image could not be uploaded. Please try again.",
      );
    } finally {
      // A cancelled upload must not clear the state of a newer one.
      if (abortRef.current === controller) {
        abortRef.current = null;
        setStage(null);
      }
    }
  };

  const isDesktop = kind === "desktop";

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={titleId} className="text-sm font-semibold text-foreground">
          {rules.label}
        </h4>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            optional ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {optional ? "Optional" : "Required"}
        </span>
      </div>

      <p id={rulesId} className="text-xs leading-relaxed text-muted-foreground">
        Recommended {rules.recommended}. At least {rules.minW} × {rules.minH} px,{" "}
        {HERO_IMAGE_RULES.formatLabel}, up to 5 MB.
        {!isDesktop && " If you skip this, phones show the desktop image."}
      </p>

      <div
        className={cn(
          "relative overflow-hidden rounded-md border border-dashed border-border bg-muted/40",
          isDesktop ? "aspect-[1920/700] w-full" : "aspect-[3/4] w-32 sm:w-36",
        )}
      >
        {value ? (
          <img
            src={value}
            alt=""
            className="size-full object-cover"
            onLoad={(e) => {
              const img = e.currentTarget;
              setDetails(
                (prev) =>
                  prev ?? {
                    name: decodeURIComponent(value.split("/").pop() ?? "Current image"),
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                  },
              );
            }}
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-muted-foreground">
            <ImageIcon className="size-6" aria-hidden="true" />
            <span className="text-xs">No image yet</span>
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          </div>
        )}
      </div>

      {value && details && !busy && (
        <p className="min-w-0 text-xs text-muted-foreground">
          <span className="block truncate font-medium text-foreground" title={details.name}>
            {details.name}
          </span>
          {details.width} × {details.height} px
          {details.size !== undefined && ` · ${formatBytes(details.size)}`}
        </p>
      )}

      {stage && (
        <p role="status" className="flex items-center gap-2 text-xs font-medium text-primary">
          {STAGE_TEXT[stage]}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs font-medium break-words text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={HERO_IMAGE_RULES.formats.join(",")}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
        {busy ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              abortRef.current?.abort();
              abortRef.current = null;
              setStage(null);
            }}
            className="min-h-10"
          >
            <X /> Cancel
          </Button>
        ) : (
          <Button
            type="button"
            variant={value ? "outline" : "default"}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            aria-describedby={rulesId}
            className="min-h-10"
          >
            {value ? <RefreshCw /> : <ImagePlus />}
            {value ? "Replace Image" : "Choose Image"}
          </Button>
        )}
        {value && onRemove && !busy && (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setDetails(null);
              setError(null);
              onRemove();
            }}
            className="min-h-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 /> Remove
          </Button>
        )}
      </div>
    </section>
  );
}
