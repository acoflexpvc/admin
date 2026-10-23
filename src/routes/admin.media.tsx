import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Image as ImageIcon,
  Upload,
  Trash2,
  Edit2,
  ExternalLink,
  Search,
  Loader2,
  FileImage,
  Copy,
  Check,
} from "lucide-react";
import type { MediaAsset } from "@/components/admin-media-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBanner, type StatusMessage } from "@/components/admin/status-banner";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { getErrorMessage } from "@/lib/errors";

export const Route = createFileRoute("/admin/media")({
  head: () => ({
    meta: [
      { title: "Media Library — Acoflex CMS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminMediaLibrary,
});

const ALLOWED_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function AdminMediaLibrary() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadAlt, setUploadAlt] = useState("");
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const [editAltText, setEditAltText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MediaAsset | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Fetch Media Assets
  const {
    data: assets,
    isLoading,
    error,
    refetch,
  } = useQuery<MediaAsset[]>({
    queryKey: ["admin_media_assets"],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { data, error: fetchErr } = await supabase
        .from("media_assets")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchErr) throw fetchErr;
      return (data || []) as MediaAsset[];
    },
  });

  // 2. Upload Mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ file, altText }: { file: File; altText: string }) => {
      if (!supabase) throw new Error("Supabase is not configured.");

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        throw new Error("Invalid format. Only WebP, JPEG, and PNG images are allowed.");
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error("File exceeds maximum allowed size of 5 MB.");
      }

      const ext = file.name.split(".").pop() || "png";
      const sanitizedBase = file.name
        .replace(/\.[^/.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .slice(0, 40);
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const filePath = `uploads/${sanitizedBase}-${uniqueSuffix}.${ext}`;

      // Upload to website-media storage bucket
      const { error: storageErr } = await supabase.storage
        .from("website-media")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });

      if (storageErr) throw storageErr;

      // Obtain public URL
      const { data: pubUrlData } = supabase.storage.from("website-media").getPublicUrl(filePath);

      const publicUrl = pubUrlData.publicUrl;

      // Register in catalog
      const { data: assetRecord, error: dbErr } = await supabase
        .from("media_assets")
        .insert({
          bucket_id: "website-media",
          file_path: filePath,
          filename: file.name,
          mime_type: file.type,
          file_size: file.size,
          public_url: publicUrl,
          alt_text: altText.trim() || sanitizedBase,
        })
        .select()
        .single();

      if (dbErr) throw dbErr;
      return assetRecord;
    },
    onSuccess: () => {
      setStatusMessage({
        type: "success",
        text: "Image uploaded and cataloged successfully.",
      });
      setUploadAlt("");
      queryClient.invalidateQueries({ queryKey: ["admin_media_assets"] });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: `Upload failed: ${getErrorMessage(err)}`,
      });
    },
  });

  // 3. Update Alt Text Mutation
  const updateMetadataMutation = useMutation({
    mutationFn: async ({ id, alt_text }: { id: string; alt_text: string }) => {
      if (!supabase) throw new Error("Supabase is not configured.");
      const { error: upErr } = await supabase
        .from("media_assets")
        .update({ alt_text, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (upErr) throw upErr;
      return true;
    },
    onSuccess: () => {
      setStatusMessage({
        type: "success",
        text: "Media metadata updated successfully.",
      });
      setEditingAsset(null);
      queryClient.invalidateQueries({ queryKey: ["admin_media_assets"] });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: `Update failed: ${getErrorMessage(err)}`,
      });
    },
  });

  // 4. Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: async (asset: MediaAsset) => {
      if (!supabase) throw new Error("Supabase is not configured.");

      // Remove from storage bucket
      const { error: storageDelErr } = await supabase.storage
        .from("website-media")
        .remove([asset.file_path]);

      if (storageDelErr) {
        console.warn("Storage delete warning:", storageDelErr.message);
      }

      // Remove from database catalog
      const { error: dbDelErr } = await supabase.from("media_assets").delete().eq("id", asset.id);

      if (dbDelErr) throw dbDelErr;
      return true;
    },
    onSuccess: () => {
      setStatusMessage({
        type: "success",
        text: "Image deleted from storage and catalog successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin_media_assets"] });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: `Failed to delete media asset: ${getErrorMessage(err)}`,
      });
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    uploadMutation.mutate({ file, altText: uploadAlt });
  };

  const handleCopyUrl = async (asset: MediaAsset) => {
    try {
      await navigator.clipboard.writeText(asset.public_url);
      setCopiedId(asset.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setStatusMessage({
        type: "error",
        text: "Could not copy the link. Please copy it manually.",
      });
    }
  };

  const filteredAssets = assets?.filter((a) => {
    const q = searchQuery.toLowerCase();
    return (
      a.filename.toLowerCase().includes(q) || (a.alt_text && a.alt_text.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Images & Gallery</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload and view photos for your products and website pages.
          </p>
        </div>
      </div>

      {/* Prominent Upload Area */}
      <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-6 hover:border-primary/50 transition-colors">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4 text-center md:text-left">
            <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Upload className="size-7" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Upload Photos to Website</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Supports <strong className="text-foreground font-medium">PNG, JPEG, WebP</strong> up
                to <strong className="text-foreground font-medium">5 MB</strong>. Photos are
                automatically saved and ready for products and pages.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
            <Label htmlFor="upload-alt" className="sr-only">
              Photo description
            </Label>
            <Input
              id="upload-alt"
              placeholder="Photo description (optional)..."
              value={uploadAlt}
              onChange={(e) => setUploadAlt(e.target.value)}
              className="w-full sm:w-60 h-10 text-sm bg-card"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/webp,image/jpeg,image/png"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={handleFileUpload}
            />
            <Button
              type="button"
              variant="gold"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadMutation.isPending}
              className="h-10 px-5 shadow-xs"
            >
              {uploadMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploadMutation.isPending ? "Uploading…" : "Select & Upload Photo"}
            </Button>
          </div>
        </div>
      </div>

      <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage(null)} />

      {/* Filter / Search Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48 max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search images"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search assets by filename or alt text..."
            className="pl-9 h-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filteredAssets?.length || 0} assets found
        </span>
      </div>

      {/* Assets Grid */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-destructive">
          <p className="font-semibold">Failed to load media catalog</p>
          <p className="text-sm mt-1">{getErrorMessage(error)}</p>
          <Button onClick={() => refetch()} variant="outline" className="mt-4">
            Try Again
          </Button>
        </div>
      ) : filteredAssets && filteredAssets.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredAssets.map((asset) => (
            <div
              key={asset.id}
              className="group rounded-xl border border-border bg-card overflow-hidden shadow-xs hover:border-primary/40 transition-all flex flex-col"
            >
              <div className="aspect-square bg-muted/20 relative flex items-center justify-center overflow-hidden">
                <img
                  src={asset.public_url}
                  alt={asset.alt_text || asset.filename}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
                {/* Always visible on touch screens; on larger screens shown on hover or keyboard focus. */}
                <div className="absolute top-2 right-2 flex gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleCopyUrl(asset)}
                    className="p-2 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    title="Copy image link"
                    aria-label={`Copy link for ${asset.filename}`}
                  >
                    {copiedId === asset.id ? (
                      <Check className="size-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="size-3.5" />
                    )}
                  </button>
                  <a
                    href={asset.public_url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-md bg-black/60 text-white hover:bg-black/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    title="Open full size"
                    aria-label={`Open ${asset.filename} full size`}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </div>
              </div>

              <div className="p-3.5 flex-1 flex flex-col justify-between text-xs space-y-2">
                <div className="min-w-0">
                  <h4 className="font-semibold text-foreground truncate" title={asset.filename}>
                    {asset.filename}
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                    Alt: {asset.alt_text || "—"}
                  </p>
                  <p className="text-[10px] text-muted-foreground/80 mt-1">
                    {(asset.file_size / 1024).toFixed(0)} KB ·{" "}
                    {(asset.mime_type.split("/")[1] ?? asset.mime_type).toUpperCase()} ·{" "}
                    {new Date(asset.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs gap-1"
                    aria-label={`Edit description of ${asset.filename}`}
                    onClick={() => {
                      setEditingAsset(asset);
                      setEditAltText(asset.alt_text || "");
                    }}
                  >
                    <Edit2 className="size-3" /> Edit Description
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-destructive hover:bg-destructive/10 gap-1"
                    aria-label={`Delete ${asset.filename}`}
                    onClick={() => setPendingDelete(asset)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="size-3" /> Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 border border-dashed border-border rounded-xl space-y-3">
          <FileImage className="size-12 text-muted-foreground/40 mx-auto" />
          <h3 className="text-base font-semibold text-foreground">Media library is empty</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Upload your first product photo or brand graphic. Files will be stored in Supabase
            Storage with high-speed CDN delivery.
          </p>
        </div>
      )}

      {/* Edit Alt Text Dialog */}
      <Dialog open={!!editingAsset} onOpenChange={(open) => !open && setEditingAsset(null)}>
        <DialogContent className="max-w-md">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (editingAsset) {
                updateMetadataMutation.mutate({ id: editingAsset.id, alt_text: editAltText });
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit image description</DialogTitle>
            </DialogHeader>
            <p className="truncate text-xs text-muted-foreground" title={editingAsset?.filename}>
              {editingAsset?.filename}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="edit-alt">Description (alt text)</Label>
              <Input
                id="edit-alt"
                value={editAltText}
                onChange={(e) => setEditAltText(e.target.value)}
                placeholder="What the photo shows, e.g. CPVC pipes on the test rig"
              />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingAsset(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="gold"
                disabled={updateMetadataMutation.isPending}
                className="gap-1.5"
              >
                {updateMetadataMutation.isPending && <Loader2 className="animate-spin" />}
                {updateMetadataMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Delete this image?"
        description={
          <>
            <span className="block break-all font-medium text-foreground">
              {pendingDelete?.filename}
            </span>
            It will be removed from the library. Any product or page still using it will show a
            missing image. This cannot be undone.
          </>
        }
        confirmLabel="Delete Image"
        destructive
        onConfirm={() => pendingDelete && deleteMutation.mutate(pendingDelete)}
      />
    </div>
  );
}
