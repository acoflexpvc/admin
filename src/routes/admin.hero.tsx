// src/routes/admin.hero.tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, AlertCircle, ArrowLeft, Move, Trash2, Plus } from "lucide-react";
// import { v4 as uuidv4 } from "uuid";
const generateUuid = () => crypto.randomUUID();
import { useAdminAuth } from "@/lib/admin-auth";

/**
 * Admin page for managing Hero Slider slides.
 * Uses Supabase RPCs defined in the migration:
 *   rpc_create_hero_slide, rpc_update_hero_slide,
 *   rpc_soft_delete_hero_slide, rpc_reorder_hero_slides.
 * Image validation is handled by the `validate-hero-image` Edge Function.
 */
export const Route = createFileRoute("/admin/hero")({
  component: AdminHeroSlider,
});

interface HeroSlide {
  id: string;
  name: string;
  desktop_image: string;
  mobile_image: string | null;
  heading: string | null;
  description: string | null;
  cta_label: string | null;
  cta_url: string | null;
  alt_text: string | null;
  sort_order: number;
  is_active: boolean;
}

// Blank optional form fields are sent as NULL: the RPCs treat NULL as "not set", but reject ""
// (e.g. is_valid_cta_url('') is false, so an empty CTA URL would block saving).
const emptyToNull = (value: string | null | undefined) =>
  value && value.trim() !== "" ? value : null;

// Supabase returns PostgREST errors as plain objects, not Error instances.
const errorMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : fallback;
};

function AdminHeroSlider() {
  const { user, isAdmin, isLoading: authLoading, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Fetch all non‑deleted slides (including drafts)
  const {
    data: slides,
    isLoading,
    error,
  } = useQuery<HeroSlide[]>({
    queryKey: ["admin_hero_slides"],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase not configured");
      const { data, error } = await supabase
        .from("hero_slides")
        .select("*")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data as HeroSlide[];
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<Partial<HeroSlide>>({
    name: "",
    heading: "",
    description: "",
    cta_label: "",
    cta_url: "",
    alt_text: "",
    is_active: false,
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Helper: count active slides
  const activeCount = useMemo(() => slides?.filter((s) => s.is_active).length ?? 0, [slides]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (payload: Partial<HeroSlide>) => {
      if (!supabase) throw new Error("Supabase not configured");
      const { data, error } = await supabase.rpc("rpc_create_hero_slide", {
        p_name: payload.name,
        p_desktop_image: payload.desktop_image,
        p_mobile_image: emptyToNull(payload.mobile_image),
        p_heading: emptyToNull(payload.heading),
        p_description: emptyToNull(payload.description),
        p_cta_label: emptyToNull(payload.cta_label),
        p_cta_url: emptyToNull(payload.cta_url),
        p_alt_text: emptyToNull(payload.alt_text),
        p_sort_order: payload.sort_order ?? 0,
        p_is_active: payload.is_active ?? false,
        p_created_by: user?.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_hero_slides"] });
      setShowForm(false);
      setStatusMessage({ type: "success", text: "Slide created successfully." });
    },
    onError: (err: unknown) => {
      setStatusMessage({ type: "error", text: errorMessage(err, "Failed to create slide") });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: Partial<HeroSlide> & { id: string }) => {
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.rpc("rpc_update_hero_slide", {
        p_id: payload.id,
        p_name: payload.name,
        p_desktop_image: payload.desktop_image,
        p_mobile_image: emptyToNull(payload.mobile_image),
        p_heading: emptyToNull(payload.heading),
        p_description: emptyToNull(payload.description),
        p_cta_label: emptyToNull(payload.cta_label),
        p_cta_url: emptyToNull(payload.cta_url),
        p_alt_text: emptyToNull(payload.alt_text),
        p_sort_order: payload.sort_order ?? 0,
        p_is_active: payload.is_active ?? false,
        p_updated_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_hero_slides"] });
      setShowForm(false);
      setStatusMessage({ type: "success", text: "Slide updated successfully." });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: errorMessage(err, "Failed to update slide"),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.rpc("rpc_soft_delete_hero_slide", {
        p_id: id,
        p_updated_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_hero_slides"] });
      setStatusMessage({ type: "success", text: "Slide deleted (soft) successfully." });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: errorMessage(err, "Failed to delete slide"),
      });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.rpc("rpc_reorder_hero_slides", { p_order: orderedIds });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin_hero_slides"] });
      setStatusMessage({ type: "success", text: "Slide order updated." });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: errorMessage(err, "Failed to reorder slides"),
      });
    },
  });

  // Open form for new slide
  const openCreate = () => {
    setEditingId(null);
    setFormState({
      name: "",
      heading: "",
      description: "",
      cta_label: "",
      cta_url: "",
      alt_text: "",
      is_active: false,
    });
    setShowForm(true);
    setValidationError(null);
  };

  // Open form for editing existing slide
  const openEdit = (slide: HeroSlide) => {
    setEditingId(slide.id);
    setFormState({ ...slide });
    setShowForm(true);
    setValidationError(null);
  };

  // Handle image upload & validation via Edge Function
  const handleImageUpload = async (file: File, type: "desktop" | "mobile") => {
    if (!supabase) return;
    const bucket = "website-media";
    const tempPath = `tmp/${generateUuid()}_${file.name}`;
    setStatusMessage({ type: "success", text: "Uploading image..." });
    // Upload to temporary location
    const { error: uploadErr } = await supabase.storage.from(bucket).upload(tempPath, file, {
      upsert: false,
      cacheControl: "3600",
    });
    if (uploadErr) {
      setStatusMessage({ type: "error", text: `Upload failed: ${uploadErr.message}` });
      return;
    }
    // Invoke validation edge function
    const { data, error: fnErr } = await supabase.functions.invoke("validate-hero-image", {
      body: JSON.stringify({ bucket, path: tempPath, type }),
    });
    if (fnErr) {
      // Clean up temporary file on failure
      await supabase.storage.from(bucket).remove([tempPath]);
      setStatusMessage({ type: "error", text: `Validation error: ${fnErr.message}` });
      return;
    }
    // Expected response { url, path }
    const result = typeof data === "string" ? JSON.parse(data) : data;
    if (result?.url) {
      // Store validated URL in form state
      if (type === "desktop") {
        setFormState((prev) => ({ ...prev, desktop_image: result.url }));
      } else {
        setFormState((prev) => ({ ...prev, mobile_image: result.url }));
      }
      setStatusMessage({ type: "success", text: "Image validated and stored successfully." });
    } else {
      setStatusMessage({ type: "error", text: "Unexpected validation response." });
    }
  };

  // Simple reorder by moving up/down
  const moveSlide = (index: number, direction: "up" | "down") => {
    if (!slides) return;
    const newOrder = [...slides];
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= newOrder.length) return;
    const current = newOrder[index];
    const target = newOrder[targetIdx];
    if (!current || !target) return;
    newOrder[index] = target;
    newOrder[targetIdx] = current;
    // Update sort_order values based on new order
    const orderedIds = newOrder.map((s) => s.id);
    reorderMutation.mutate(orderedIds);
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-8 animate-spin" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="p-8">
        <p className="text-destructive">Admin access required.</p>
        <Button onClick={() => navigate({ to: "/admin/login" })}>Sign In</Button>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Hero Slider Management</h1>
        <Button onClick={openCreate} variant="gold" size="sm">
          <Plus className="size-4 mr-1" /> Add Slide
        </Button>
      </div>

      {statusMessage && (
        <div
          className={`flex items-center gap-2 p-3 rounded border text-sm ${
            statusMessage.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <AlertCircle className="size-5" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {isLoading ? (
        <Loader2 className="size-8 animate-spin" />
      ) : error ? (
        <div className="text-destructive">Error loading slides: {(error as Error).message}</div>
      ) : (
        <table className="w-full table-auto border-collapse">
          <thead>
            <tr className="bg-muted">
              <th className="p-2 text-left">Order</th>
              <th className="p-2 text-left">Preview</th>
              <th className="p-2 text-left">Heading</th>
              <th className="p-2 text-left">Active</th>
              <th className="p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {slides?.map((slide, idx) => (
              <tr key={slide.id} className="border-b">
                <td className="p-2">{slide.sort_order}</td>
                <td className="p-2">
                  <img
                    src={slide.desktop_image}
                    alt={slide.alt_text ?? ""}
                    className="h-12 w-auto object-cover"
                  />
                </td>
                <td className="p-2">{slide.heading}</td>
                <td className="p-2">{slide.is_active ? "✅" : "—"}</td>
                <td className="p-2 flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(slide)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => deleteMutation.mutate(slide.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moveSlide(idx, "up")}
                    disabled={idx === 0}
                  >
                    <Move className="size-4" /> Up
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => moveSlide(idx, "down")}
                    disabled={idx === (slides?.length ?? 0) - 1}
                  >
                    Down
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Slide Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl p-6 space-y-4">
            <h2 className="text-xl font-semibold">
              {editingId ? "Edit Slide" : "Create New Slide"}
            </h2>
            {validationError && <p className="text-destructive">{validationError}</p>}
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="slide-name">Internal Name *</Label>
                <Input
                  id="slide-name"
                  required
                  value={formState.name ?? ""}
                  onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="heading">Heading</Label>
                <Input
                  id="heading"
                  value={formState.heading ?? ""}
                  onChange={(e) => setFormState((prev) => ({ ...prev, heading: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  rows={3}
                  value={formState.description ?? ""}
                  onChange={(e) =>
                    setFormState((prev) => ({ ...prev, description: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cta-label">CTA Button Text</Label>
                <Input
                  id="cta-label"
                  value={formState.cta_label ?? ""}
                  onChange={(e) => setFormState((prev) => ({ ...prev, cta_label: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cta-url">CTA URL</Label>
                <Input
                  id="cta-url"
                  value={formState.cta_url ?? ""}
                  onChange={(e) => setFormState((prev) => ({ ...prev, cta_url: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alt-text">Alt Text</Label>
                <Input
                  id="alt-text"
                  value={formState.alt_text ?? ""}
                  onChange={(e) => setFormState((prev) => ({ ...prev, alt_text: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Desktop Image *</Label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file, "desktop");
                  }}
                />
                {formState.desktop_image && (
                  <img
                    src={formState.desktop_image as string}
                    alt="Desktop preview"
                    className="h-24 mt-2"
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Mobile Image (optional)</Label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImageUpload(file, "mobile");
                  }}
                />
                {formState.mobile_image && (
                  <img
                    src={formState.mobile_image as string}
                    alt="Mobile preview"
                    className="h-24 mt-2"
                  />
                )}
              </div>
              <div className="flex items-center space-x-4">
                <Label htmlFor="active-toggle" className="flex items-center">
                  <input
                    id="active-toggle"
                    type="checkbox"
                    checked={formState.is_active ?? false}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      // Enforce max 4 active slides UI‑side
                      if (
                        checked &&
                        activeCount >= 4 &&
                        !(editingId && slides?.find((s) => s.id === editingId)?.is_active)
                      ) {
                        setValidationError(
                          "Maximum of 4 active slides reached. Deactivate another slide first.",
                        );
                        return;
                      }
                      setFormState((prev) => ({ ...prev, is_active: checked }));
                      setValidationError(null);
                    }}
                  />
                  <span className="ml-2">Active (published)</span>
                </Label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  // Basic client‑side CTA URL validation
                  if (
                    formState.cta_url &&
                    !/^https?:\/\//.test(formState.cta_url) &&
                    !/^\/[^\s]*/.test(formState.cta_url)
                  ) {
                    setValidationError("CTA URL must be absolute (https://…) or relative (/…)");
                    return;
                  }
                  if (!formState.desktop_image) {
                    setValidationError("Desktop image is required and must be validated.");
                    return;
                  }
                  if (editingId) {
                    updateMutation.mutate({ ...formState, id: editingId });
                  } else {
                    createMutation.mutate(formState);
                  }
                }}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="size-4 animate-spin mr-2" />
                )}
                {editingId ? "Save Changes" : "Create Slide"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
