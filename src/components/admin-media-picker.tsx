import React, { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Image as ImageIcon,
  Upload,
  Check,
  Search,
  Loader2,
  AlertCircle,
  FileImage,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getErrorMessage } from "@/lib/errors";

export interface MediaAsset {
  id: string;
  bucket_id: string;
  file_path: string;
  filename: string;
  mime_type: string;
  file_size: number;
  public_url: string;
  alt_text: string | null;
  created_at: string;
  updated_at: string;
}

interface MediaPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (media: { url: string; altText: string }) => void;
  currentUrl?: string | undefined;
}

const ALLOWED_MIME_TYPES = ["image/webp", "image/jpeg", "image/png"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export function MediaPickerModal({ isOpen, onClose, onSelect, currentUrl }: MediaPickerModalProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadAlt, setUploadAlt] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch media assets
  const {
    data: assets,
    isLoading,
    error,
  } = useQuery<MediaAsset[]>({
    queryKey: ["admin_media_assets"],
    enabled: isOpen,
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

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async ({ file, altText }: { file: File; altText: string }) => {
      if (!supabase) throw new Error("Supabase is not configured.");

      // 1. Validation
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        throw new Error("Invalid file type. Only WebP, JPEG, and PNG images are allowed.");
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error("File exceeds maximum allowed size of 5 MB.");
      }

      // 2. Generate collision-free file path
      const ext = file.name.split(".").pop() || "png";
      const sanitizedBase = file.name
        .replace(/\.[^/.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .slice(0, 40);
      const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const filePath = `uploads/${sanitizedBase}-${uniqueSuffix}.${ext}`;

      // 3. Upload to Storage bucket
      const { error: storageErr } = await supabase.storage
        .from("website-media")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });

      if (storageErr) throw storageErr;

      // 4. Retrieve Public URL
      const { data: pubUrlData } = supabase.storage.from("website-media").getPublicUrl(filePath);

      const publicUrl = pubUrlData.publicUrl;

      // 5. Insert record into media_assets catalog
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
      return assetRecord as MediaAsset;
    },
    onSuccess: (newAsset) => {
      queryClient.invalidateQueries({ queryKey: ["admin_media_assets"] });
      setSelectedAsset(newAsset);
      setUploadAlt("");
      setUploadError(null);
    },
    onError: (err: unknown) => {
      setUploadError(getErrorMessage(err));
    },
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const file = e.target.files?.[0];
    e.target.value = ""; // Reset input
    if (!file) return;
    uploadMutation.mutate({ file, altText: uploadAlt });
  };

  const handleConfirmSelect = () => {
    if (!selectedAsset) return;
    onSelect({
      url: selectedAsset.public_url,
      altText: selectedAsset.alt_text || selectedAsset.filename,
    });
    onClose();
  };

  const filteredAssets = assets?.filter((a) => {
    const q = searchQuery.toLowerCase();
    return (
      a.filename.toLowerCase().includes(q) || (a.alt_text && a.alt_text.toLowerCase().includes(q))
    );
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-w-4xl flex-col gap-0 overflow-hidden p-0">
        {/* Modal Header */}
        <div className="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
          <ImageIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
          <DialogTitle className="text-lg">Select or Upload Media</DialogTitle>
          <DialogDescription className="sr-only">
            Choose an image from the library or upload a new one.
          </DialogDescription>
        </div>

        {/* Upload & Search Toolbar */}
        <div className="p-4 border-b border-border bg-muted/20 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search
                className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Search media library"
                placeholder="Search media library..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            <div className="flex flex-col min-[420px]:flex-row items-stretch gap-2 w-full sm:w-auto">
              <Input
                aria-label="Description for the uploaded image"
                placeholder="Description for upload..."
                value={uploadAlt}
                onChange={(e) => setUploadAlt(e.target.value)}
                className="h-9 min-w-0 flex-1 sm:w-44"
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
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
                className="shrink-0"
              >
                {uploadMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                {uploadMutation.isPending ? "Uploading…" : "Upload Image"}
              </Button>
            </div>
          </div>

          {uploadError && (
            <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/20">
              <AlertCircle className="size-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}
        </div>

        {/* Media Grid */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive text-sm">
              Failed to load media catalog: {getErrorMessage(error)}
            </div>
          ) : filteredAssets && filteredAssets.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filteredAssets.map((asset) => {
                const isSelected =
                  selectedAsset?.id === asset.id || currentUrl === asset.public_url;
                return (
                  <button
                    type="button"
                    key={asset.id}
                    onClick={() => setSelectedAsset(asset)}
                    aria-pressed={isSelected}
                    className={`group relative cursor-pointer rounded-lg border overflow-hidden text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      isSelected
                        ? "border-primary ring-2 ring-primary ring-offset-2"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="aspect-square bg-muted/30 relative flex items-center justify-center overflow-hidden">
                      <img
                        src={asset.public_url}
                        alt={asset.alt_text || asset.filename}
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                        onError={(e) => {
                          // Fallback icon on broken image
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                      {isSelected && (
                        <div className="absolute top-2 right-2 rounded-full bg-primary text-primary-foreground p-1 shadow-md">
                          <Check className="size-3.5" />
                        </div>
                      )}
                    </div>
                    <div className="p-2 text-xs bg-card">
                      <p className="font-medium text-foreground truncate">{asset.filename}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {(asset.file_size / 1024).toFixed(0)} KB · {asset.mime_type.split("/")[1]}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 space-y-3">
              <FileImage className="size-12 text-muted-foreground/40 mx-auto" />
              <p className="text-sm font-medium text-foreground">No media assets found</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Upload your first product photo or brand graphic (PNG, WebP, JPEG up to 5MB).
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="border-t border-border px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center bg-card">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {selectedAsset ? (
              <span>
                Selected: <strong className="text-foreground">{selectedAsset.filename}</strong>
              </span>
            ) : (
              "Select an image from the catalog or upload a new one"
            )}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="gold"
              onClick={handleConfirmSelect}
              disabled={!selectedAsset}
              className="gap-1.5"
            >
              Use Selected Image
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
