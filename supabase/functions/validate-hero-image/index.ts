// Supabase Edge Function (Deno 2): validate-hero-image
import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { fileTypeFromBuffer } from "npm:file-type@18.7.0";
import { imageSize } from "npm:image-size@1.1.1";

// Private bucket the admin uploads temporary files to (see 20261023000001_home_hero_banner.sql)
const TEMP_BUCKET = "hero-uploads";
// Public bucket that serves validated banner images (see 20261010000004_storage_and_media.sql)
const PUBLIC_BUCKET = "website-media";

// Allowed mime types and corresponding extensions. SVG and everything else is rejected.
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Validation specifications. Keep in sync with HERO_IMAGE_RULES in the admin
// (src/lib/hero-image.ts), which shows these limits to the client.
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const SPECS = {
  desktop: {
    label: "Desktop banner images",
    minW: 1600,
    minH: 580,
    ratio: 1920 / 700,
    example: "1920 × 700 px",
  },
  mobile: {
    label: "Mobile banner images",
    minW: 750,
    minH: 1000,
    ratio: 900 / 1200,
    example: "900 × 1200 px",
  },
} as const;
// Allowed deviation from the target aspect ratio, relative (6%).
const RATIO_TOLERANCE = 0.06;

// supabase-js sends authorization, apikey and x-client-info, so browsers preflight every call
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const formatRatio = (ratio: number) => `${ratio.toFixed(2)}:1`;

function lastIndexOfBytes(bytes: Uint8Array, pattern: number[]): number {
  outer: for (let i = bytes.length - pattern.length; i >= 0; i--) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Structural integrity check that catches truncated or cut-off files, which the
 * header-only type and dimension readers accept. It does not decode pixels.
 */
function isStructurallyComplete(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") {
    // The end-of-image marker must follow the last start-of-scan marker.
    const lastScan = lastIndexOfBytes(bytes, [0xff, 0xda]);
    const end = lastIndexOfBytes(bytes, [0xff, 0xd9]);
    return lastScan > 0 && end > lastScan;
  }
  if (mime === "image/png") {
    // An IEND chunk must follow the last IDAT chunk.
    const lastData = lastIndexOfBytes(bytes, [0x49, 0x44, 0x41, 0x54]);
    const end = lastIndexOfBytes(bytes, [0x49, 0x45, 0x4e, 0x44]);
    return lastData > 0 && end > lastData;
  }
  if (mime === "image/webp") {
    // The RIFF header declares the payload length; a truncated file is shorter.
    if (bytes.length < 12) return false;
    const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      4,
      true,
    );
    return declared + 8 <= bytes.length;
  }
  return false;
}

/**
 * Expected JSON body:
 * {
 *   "bucket": "hero-uploads",
 *   "path": "tmp/<uuid>.<ext>",
 *   "type": "desktop" | "mobile"
 * }
 * The temporary object is always deleted before the response is sent. On
 * success the verified bytes are stored at website-media/hero/<uuid>.<ext>.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    let payload: { bucket?: unknown; path?: unknown; type?: unknown };
    try {
      payload = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const { bucket, path, type } = payload ?? {};
    if (!bucket || !path || !type) {
      return json({ error: "Missing required parameters" }, 400);
    }
    if (bucket !== TEMP_BUCKET) {
      return json({ error: "Invalid bucket" }, 400);
    }
    if (type !== "desktop" && type !== "mobile") {
      return json({ error: "Invalid type" }, 400);
    }
    // Only allow single-level temporary files inside the "tmp/" folder
    if (typeof path !== "string" || !/^tmp\/[A-Za-z0-9._-]+$/.test(path) || path.includes("..")) {
      return json({ error: "Invalid temporary path" }, 400);
    }

    // ----- Authorization -----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header" }, 401);
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("validate-hero-image: missing Supabase environment variables");
      return json({ error: "Server misconfigured" }, 500);
    }
    const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
    // Call is_admin() as the caller so auth.uid() inside it is the caller's user ID
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      ...clientOptions,
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin");
    if (adminErr || isAdmin !== true) {
      return json({ error: "Access denied: not an admin" }, 403);
    }
    // Service role is used only after the caller has been verified as an admin
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, clientOptions);
    const temp = supabaseAdmin.storage.from(TEMP_BUCKET);

    try {
      // ----- Download the temporary file into memory -----
      const { data: blob, error: downloadErr } = await temp.download(path);
      if (downloadErr || !blob) {
        return json({ error: "The uploaded file could not be read. Please try again." }, 400);
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());

      // ----- Size validation -----
      if (bytes.byteLength > MAX_SIZE) {
        return json(
          { error: "This file is larger than 5 MB. Please choose a smaller image." },
          400,
        );
      }

      // ----- MIME type detection (magic bytes, not the filename or client-supplied type) -----
      // file-type throws (e.g. End-Of-Stream) on truncated files, so treat that as unsupported too
      const typeInfo = await fileTypeFromBuffer(bytes).catch(() => undefined);
      const ext = typeInfo ? ALLOWED[typeInfo.mime] : undefined;
      if (!typeInfo || !ext) {
        return json(
          {
            error:
              "This file is not a JPEG, PNG or WebP image. Please choose a photo in one of those formats.",
          },
          400,
        );
      }

      // ----- Integrity and dimension validation -----
      const damaged = "This image appears to be damaged or incomplete and could not be read.";
      if (!isStructurallyComplete(bytes, typeInfo.mime)) {
        return json({ error: damaged }, 400);
      }
      let dimensions: { width?: number; height?: number };
      try {
        dimensions = imageSize(Buffer.from(bytes));
      } catch {
        return json({ error: damaged }, 400);
      }
      const { width, height } = dimensions;
      if (!width || !height) {
        return json({ error: damaged }, 400);
      }
      const spec = SPECS[type];
      // Shape first: a portrait photo uploaded as a desktop banner needs cropping, not resizing.
      const actualRatio = width / height;
      if (Math.abs(actualRatio - spec.ratio) / spec.ratio > RATIO_TOLERANCE) {
        return json(
          {
            error: `This image's shape is ${formatRatio(actualRatio)} (${width} × ${height} px). ${spec.label} need a shape of about ${formatRatio(spec.ratio)}, for example ${spec.example}. Please crop the image and try again.`,
          },
          400,
        );
      }
      if (width < spec.minW || height < spec.minH) {
        return json(
          {
            error: `This image is ${width} × ${height} px, which is too small. ${spec.label} must be at least ${spec.minW} × ${spec.minH} px (recommended ${spec.example}). Please use a larger original.`,
          },
          400,
        );
      }

      // ----- Store the verified bytes at an immutable public location -----
      const destPath = `hero/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabaseAdmin.storage
        .from(PUBLIC_BUCKET)
        .upload(destPath, bytes, {
          contentType: typeInfo.mime,
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploadErr) {
        console.error("validate-hero-image: failed to store validated image", uploadErr.message);
        return json({ error: "The image could not be saved. Please try again." }, 500);
      }

      const { data: publicInfo } = supabaseAdmin.storage.from(PUBLIC_BUCKET).getPublicUrl(destPath);
      return json(
        {
          url: publicInfo.publicUrl,
          path: destPath,
          width,
          height,
          size: bytes.byteLength,
          mime: typeInfo.mime,
        },
        200,
      );
    } finally {
      // The temporary object never outlives this request, whatever the outcome.
      const { error: removeErr } = await temp.remove([path]);
      if (removeErr) {
        console.error("validate-hero-image: failed to remove temp file", removeErr.message);
      }
    }
  } catch (e) {
    console.error("Unexpected error in validate-hero-image:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
