// Supabase Edge Function (Deno 2): validate-hero-image
import { Buffer } from "node:buffer";
import { createClient } from "npm:@supabase/supabase-js@2.109.0";
import { fileTypeFromBuffer } from "npm:file-type@18.7.0";
import { imageSize } from "npm:image-size@1.1.1";

// The only bucket this function may read from or write to (see 20261010000004_storage_and_media.sql)
const BUCKET = "website-media";

// Allowed mime types and corresponding extensions
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Validation specifications
const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
const DESKTOP = { minW: 1600, minH: 600, ratio: 1920 / 700, tolerance: 0.15 };
const MOBILE = { minW: 800, minH: 1000, ratio: 3 / 4, tolerance: 0.15 };

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

/**
 * Expected JSON body (the admin UI sends it as a JSON string):
 * {
 *   "bucket": "website-media",
 *   "path": "tmp/unique-id.tmp",
 *   "type": "desktop" | "mobile"
 * }
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
    if (bucket !== BUCKET) {
      return json({ error: "Invalid bucket" }, 400);
    }
    if (type !== "desktop" && type !== "mobile") {
      return json({ error: "Invalid type" }, 400);
    }
    // Only allow temporary files inside the "tmp/" folder
    if (typeof path !== "string" || !path.startsWith("tmp/") || path.includes("..")) {
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
    const storage = supabaseAdmin.storage.from(BUCKET);
    const reject = async (error: string, status = 400) => {
      await storage.remove([path]);
      return json({ error }, status);
    };

    // ----- Create signed URL for the temporary file -----
    const { data: signed, error: signErr } = await storage.createSignedUrl(path, 60);
    if (signErr || !signed?.signedUrl) {
      return json({ error: "Unable to create signed URL" }, 500);
    }

    // ----- Download file into memory -----
    const resp = await fetch(signed.signedUrl);
    if (!resp.ok) {
      return json({ error: "Failed to download uploaded file" }, 500);
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());

    // ----- Size validation -----
    if (bytes.byteLength > MAX_SIZE) {
      return await reject("File exceeds 2 MB limit");
    }

    // ----- MIME type detection (magic bytes, not the client-supplied type) -----
    // file-type throws (e.g. End-Of-Stream) on truncated files, so treat that as unsupported too
    const typeInfo = await fileTypeFromBuffer(bytes).catch(() => undefined);
    const ext = typeInfo ? ALLOWED[typeInfo.mime] : undefined;
    if (!ext) {
      return await reject("Unsupported image format");
    }

    // ----- Dimension validation -----
    let dimensions: { width?: number; height?: number };
    try {
      dimensions = imageSize(Buffer.from(bytes));
    } catch {
      return await reject("Unable to read image dimensions");
    }
    if (!dimensions.width || !dimensions.height) {
      return await reject("Unable to read image dimensions");
    }
    const spec = type === "desktop" ? DESKTOP : MOBILE;
    if (dimensions.width < spec.minW || dimensions.height < spec.minH) {
      return await reject(`Image too small. Minimum ${spec.minW}x${spec.minH}px required.`);
    }
    const actualRatio = dimensions.width / dimensions.height;
    if (Math.abs(actualRatio - spec.ratio) > spec.tolerance) {
      return await reject("Image aspect ratio out of allowed tolerance");
    }

    // ----- Move to immutable final location -----
    const destPath = `hero/${crypto.randomUUID()}.${ext}`;
    const { error: moveErr } = await storage.move(path, destPath);
    if (moveErr) {
      return await reject("Failed to move validated image", 500);
    }

    // ----- Return public URL of the validated image -----
    const { data: publicInfo } = storage.getPublicUrl(destPath);
    return json({ url: publicInfo.publicUrl, path: destPath }, 200);
  } catch (e) {
    console.error("Unexpected error in validate-hero-image:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
