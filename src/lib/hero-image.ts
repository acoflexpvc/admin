import { supabase } from "@/lib/supabase";
import { getErrorMessage, getFunctionErrorMessage } from "@/lib/errors";

/**
 * Hero banner image rules shown to the client and checked in the browser for
 * instant feedback. The validate-hero-image Edge Function enforces the same
 * numbers on the stored bytes — keep both in sync.
 */
export const HERO_IMAGE_RULES = {
  maxBytes: 5 * 1024 * 1024,
  formats: ["image/jpeg", "image/png", "image/webp"],
  formatLabel: "JPEG, PNG or WebP",
  ratioTolerance: 0.06,
  desktop: {
    label: "Desktop banner image",
    minW: 1600,
    minH: 580,
    ratio: 1920 / 700,
    recommended: "1920 × 700 px",
    /** Larger uploads are scaled down to this width before upload. */
    targetW: 1920,
  },
  mobile: {
    label: "Mobile banner image",
    minW: 750,
    minH: 1000,
    ratio: 900 / 1200,
    recommended: "900 × 1200 px",
    targetW: 900,
  },
} as const;

export type HeroImageKind = "desktop" | "mobile";

export interface UploadedHeroImage {
  url: string;
  path: string;
  width: number;
  height: number;
  size: number;
  mime: string;
}

export type UploadStage = "checking" | "optimising" | "uploading" | "verifying";

const TEMP_BUCKET = "hero-uploads";
const PUBLIC_BUCKET = "website-media";
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export class HeroImageError extends Error {}

export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const formatRatio = (ratio: number) => `${ratio.toFixed(2)}:1`;

/** Checks a decoded image's size and shape. Returns a client-facing message, or null when it fits. */
export function checkDimensions(kind: HeroImageKind, width: number, height: number): string | null {
  const spec = HERO_IMAGE_RULES[kind];
  const ratio = width / height;
  if (Math.abs(ratio - spec.ratio) / spec.ratio > HERO_IMAGE_RULES.ratioTolerance) {
    return `This image's shape is ${formatRatio(ratio)} (${width} × ${height} px). A ${spec.label.toLowerCase()} needs a shape of about ${formatRatio(spec.ratio)}, for example ${spec.recommended}. Please crop the image and try again.`;
  }
  if (width < spec.minW || height < spec.minH) {
    return `This image is ${width} × ${height} px, which is too small. A ${spec.label.toLowerCase()} must be at least ${spec.minW} × ${spec.minH} px (recommended ${spec.recommended}). Please use a larger original.`;
  }
  return null;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Scales the image down to the target width (never up) and re-encodes it as
 * WebP, or JPEG where the browser cannot encode WebP. Re-encoding also strips
 * camera metadata (EXIF/GPS) from the public file.
 */
async function optimise(bitmap: ImageBitmap, kind: HeroImageKind): Promise<Blob> {
  const { targetW } = HERO_IMAGE_RULES[kind];
  const scale = Math.min(1, targetW / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new HeroImageError(
      "Your browser could not prepare this image. Please try another browser.",
    );
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const webp = await canvasToBlob(canvas, "image/webp", 0.82);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.85);
  if (!jpeg)
    throw new HeroImageError(
      "Your browser could not prepare this image. Please try another browser.",
    );
  return jpeg;
}

/** Extracts the website-media object path from a public URL, or null for other URLs. */
export function publicObjectPath(url: string): string | null {
  const marker = `/storage/v1/object/public/${PUBLIC_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = decodeURIComponent(url.slice(index + marker.length));
  return path.startsWith("hero/") ? path : null;
}

/**
 * Deletes a hero image from public storage. Only call this for images that
 * were uploaded in the current editing session and are not referenced by the
 * saved draft or the published page.
 */
export async function deleteUnusedHeroImage(url: string): Promise<void> {
  const path = publicObjectPath(url);
  if (!supabase || !path) return;
  const { error } = await supabase.storage.from(PUBLIC_BUCKET).remove([path]);
  if (error) console.warn("Could not remove unused hero image", error.message);
}

/**
 * Full upload flow for one banner image:
 * check in the browser → optimise → upload to the private temp bucket →
 * verify on the server (which stores the public copy and deletes the temp file).
 */
export async function uploadHeroImage(
  file: File,
  kind: HeroImageKind,
  onStage: (stage: UploadStage) => void,
  signal?: AbortSignal,
): Promise<UploadedHeroImage> {
  if (!supabase) throw new HeroImageError("The database connection is not available.");

  onStage("checking");
  if (!(HERO_IMAGE_RULES.formats as readonly string[]).includes(file.type)) {
    throw new HeroImageError(
      `"${file.name}" is not a ${HERO_IMAGE_RULES.formatLabel} image. SVG, GIF, HEIC and other formats are not accepted.`,
    );
  }
  if (file.size > HERO_IMAGE_RULES.maxBytes) {
    throw new HeroImageError(
      `"${file.name}" is ${formatBytes(file.size)}. The maximum is 5 MB — please choose a smaller file.`,
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new HeroImageError(`"${file.name}" appears to be damaged and could not be opened.`);
  }

  let blob: Blob;
  try {
    const problem = checkDimensions(kind, bitmap.width, bitmap.height);
    if (problem) throw new HeroImageError(problem);
    onStage("optimising");
    blob = await optimise(bitmap, kind);
  } finally {
    bitmap.close();
  }
  if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");

  onStage("uploading");
  const tempPath = `tmp/${crypto.randomUUID()}.${EXTENSIONS[blob.type] ?? "webp"}`;
  const temp = supabase.storage.from(TEMP_BUCKET);
  const { error: uploadErr } = await temp.upload(tempPath, blob, {
    contentType: blob.type,
    upsert: false,
  });
  if (uploadErr) {
    throw new HeroImageError(`Upload failed: ${getErrorMessage(uploadErr)}`);
  }

  onStage("verifying");
  const { data, error: fnErr } = await supabase.functions.invoke<UploadedHeroImage>(
    "validate-hero-image",
    { body: { bucket: TEMP_BUCKET, path: tempPath, type: kind } },
  );
  if (fnErr || !data?.url) {
    // The function deletes the temp file itself; this covers network failures before it ran.
    await temp.remove([tempPath]);
    throw new HeroImageError(
      fnErr
        ? await getFunctionErrorMessage(fnErr, "The image could not be verified. Please try again.")
        : "The image could not be verified. Please try again.",
    );
  }
  if (signal?.aborted) {
    await deleteUnusedHeroImage(data.url);
    throw new DOMException("Upload cancelled", "AbortError");
  }
  return data;
}
