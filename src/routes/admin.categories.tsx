import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  FolderTree,
  Plus,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowUpDown,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({
    meta: [
      { title: "Manage Categories — Acoflex CMS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminCategories,
});

interface ProductCategory {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  banner_url: string;
  image_url: string | null;
  image_alt: string | null;
  coming_soon: boolean;
  sort_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

function AdminCategories() {
  const queryClient = useQueryClient();

  const [editingCategory, setEditingCategory] = useState<Partial<ProductCategory> | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // 1. Fetch categories directly (admin has full access via RLS)
  const {
    data: categoriesList,
    isLoading,
    error,
    refetch,
  } = useQuery<ProductCategory[]>({
    queryKey: ["admin_categories"],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase client is not available.");
      const { data, error: catErr } = await supabase
        .from("product_categories")
        .select("*")
        .order("sort_order", { ascending: true });

      if (catErr) throw catErr;
      return (data || []) as ProductCategory[];
    },
  });

  // 2. Mutation for Saving (Create or Update) Category
  const saveCategoryMutation = useMutation({
    mutationFn: async (payload: Partial<ProductCategory>) => {
      if (!supabase) throw new Error("Supabase client is not available.");

      if (payload.id) {
        // Update
        const { error: updateErr } = await supabase
          .from("product_categories")
          .update({
            name: payload.name,
            slug: payload.slug,
            summary: payload.summary,
            description: payload.description,
            banner_url: payload.banner_url,
            image_url: payload.image_url || null,
            image_alt: payload.image_alt || null,
            coming_soon: payload.coming_soon ?? false,
            sort_order: Number(payload.sort_order) || 0,
            is_published: payload.is_published ?? true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", payload.id);

        if (updateErr) throw updateErr;
      } else {
        // Insert
        const { error: insertErr } = await supabase.from("product_categories").insert({
          name: payload.name,
          slug: payload.slug,
          summary: payload.summary,
          description: payload.description,
          banner_url: payload.banner_url,
          image_url: payload.image_url || null,
          image_alt: payload.image_alt || null,
          coming_soon: payload.coming_soon ?? false,
          sort_order: Number(payload.sort_order) || 0,
          is_published: payload.is_published ?? true,
        });

        if (insertErr) throw insertErr;
      }
      return true;
    },
    onSuccess: () => {
      setStatusMessage({
        type: "success",
        text: "Category saved successfully.",
      });
      setIsModalOpen(false);
      setEditingCategory(null);
      queryClient.invalidateQueries({ queryKey: ["admin_categories"] });
      queryClient.invalidateQueries({ queryKey: ["product_categories", "published"] });
    },
    onError: (err: Error) => {
      setStatusMessage({
        type: "error",
        text: `Error saving category: ${err.message}`,
      });
    },
  });

  // 3. Quick Toggle Publication Status Mutation
  const togglePublishMutation = useMutation({
    mutationFn: async ({ id, is_published }: { id: string; is_published: boolean }) => {
      if (!supabase) throw new Error("Supabase client is not available.");
      const { error: toggleErr } = await supabase
        .from("product_categories")
        .update({
          is_published,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (toggleErr) throw toggleErr;
      return true;
    },
    onSuccess: () => {
      setStatusMessage({
        type: "success",
        text: "Category publication state updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin_categories"] });
      queryClient.invalidateQueries({ queryKey: ["product_categories", "published"] });
    },
    onError: (err: Error) => {
      setStatusMessage({
        type: "error",
        text: `Failed to toggle category: ${err.message}`,
      });
    },
  });

  const handleOpenEdit = (category: ProductCategory) => {
    setEditingCategory(category);
    setIsModalOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingCategory({
      name: "",
      slug: "",
      summary: "",
      description: "",
      banner_url: "/placeholder.svg",
      image_url: null,
      image_alt: null,
      coming_soon: false,
      sort_order: (categoriesList?.length || 0) * 10 + 10,
      is_published: true,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;

    if (!editingCategory.name?.trim() || !editingCategory.slug?.trim()) {
      setStatusMessage({
        type: "error",
        text: "Name and Slug are required fields.",
      });
      return;
    }

    saveCategoryMutation.mutate(editingCategory);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-destructive">
        <p className="font-semibold">Error loading categories</p>
        <p className="text-sm mt-1">{(error as Error).message}</p>
        <Button onClick={() => refetch()} variant="outline" className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Product Categories</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Organize pipe systems, solutions, and catalogue groupings.
          </p>
        </div>

        <Button onClick={handleOpenCreate} variant="default" size="sm" className="gap-1.5">
          <Plus className="size-4" /> Add Category
        </Button>
      </div>

      {statusMessage && (
        <div
          className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${
            statusMessage.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          ) : (
            <AlertCircle className="size-5 shrink-0 text-destructive mt-0.5" />
          )}
          <p className="font-medium">{statusMessage.text}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {categoriesList?.map((cat) => (
          <div
            key={cat.id}
            className="flex items-center justify-between p-4 rounded-xl border border-border bg-card shadow-xs hover:border-primary/40 transition-colors"
          >
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-lg bg-primary/10 text-primary mt-0.5">
                <FolderTree className="size-5" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground text-base">{cat.name}</h3>
                  <code className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                    slug: {cat.slug}
                  </code>
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <ArrowUpDown className="size-3" /> Order: {cat.sort_order}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1 max-w-xl">{cat.summary}</p>
                <div className="flex items-center gap-2 pt-0.5">
                  {cat.is_published ? (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                      Published
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                      Unpublished / Hidden
                    </span>
                  )}
                  {cat.coming_soon && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20">
                      Coming Soon
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 mr-2">
                <Label htmlFor={`pub-${cat.id}`} className="text-xs text-muted-foreground">
                  Live
                </Label>
                <Switch
                  id={`pub-${cat.id}`}
                  checked={cat.is_published}
                  onCheckedChange={(checked) =>
                    togglePublishMutation.mutate({ id: cat.id, is_published: checked })
                  }
                  disabled={togglePublishMutation.isPending}
                />
              </div>
              <a
                href={`${import.meta.env.VITE_PUBLIC_WEBSITE_URL || "https://acoflex.com"}/products/${cat.slug}`}
                target="_blank"
                rel="noreferrer"
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="View on site"
              >
                <ExternalLink className="size-4" />
              </a>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenEdit(cat)}
                className="gap-1.5"
              >
                <Edit2 className="size-3.5" /> Edit
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create Category Modal */}
      {isModalOpen && editingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="font-semibold text-foreground text-lg">
                {editingCategory.id ? "Edit Category" : "New Category"}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-semibold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-auto p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cat-name">Category Name *</Label>
                  <Input
                    id="cat-name"
                    required
                    value={editingCategory.name || ""}
                    onChange={(e) =>
                      setEditingCategory({ ...editingCategory, name: e.target.value })
                    }
                    placeholder="e.g. Plumbing Solutions"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cat-slug">URL Slug *</Label>
                  <Input
                    id="cat-slug"
                    required
                    value={editingCategory.slug || ""}
                    onChange={(e) =>
                      setEditingCategory({ ...editingCategory, slug: e.target.value })
                    }
                    placeholder="plumbing"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cat-summary">Summary (Card / Menu Preview)</Label>
                <Input
                  id="cat-summary"
                  value={editingCategory.summary || ""}
                  onChange={(e) =>
                    setEditingCategory({ ...editingCategory, summary: e.target.value })
                  }
                  placeholder="Short one-line description"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cat-desc">Full Description</Label>
                <Textarea
                  id="cat-desc"
                  rows={3}
                  value={editingCategory.description || ""}
                  onChange={(e) =>
                    setEditingCategory({ ...editingCategory, description: e.target.value })
                  }
                  placeholder="Comprehensive category overview paragraph..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="cat-order">Sort Order</Label>
                  <Input
                    id="cat-order"
                    type="number"
                    value={editingCategory.sort_order ?? 10}
                    onChange={(e) =>
                      setEditingCategory({
                        ...editingCategory,
                        sort_order: parseInt(e.target.value, 10) || 0,
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="cat-banner">Banner Image URL</Label>
                  <Input
                    id="cat-banner"
                    value={editingCategory.banner_url || ""}
                    onChange={(e) =>
                      setEditingCategory({ ...editingCategory, banner_url: e.target.value })
                    }
                    placeholder="/assets/... or storage URL"
                  />
                </div>
              </div>

              <div className="flex items-center gap-6 pt-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="cat-coming-soon"
                    checked={editingCategory.coming_soon ?? false}
                    onCheckedChange={(checked) =>
                      setEditingCategory({ ...editingCategory, coming_soon: checked })
                    }
                  />
                  <Label htmlFor="cat-coming-soon" className="cursor-pointer">
                    Coming Soon Badge
                  </Label>
                </div>

                <div className="flex items-center gap-2">
                  <Switch
                    id="cat-is-published"
                    checked={editingCategory.is_published ?? true}
                    onCheckedChange={(checked) =>
                      setEditingCategory({ ...editingCategory, is_published: checked })
                    }
                  />
                  <Label htmlFor="cat-is-published" className="cursor-pointer">
                    Publish Immediately
                  </Label>
                </div>
              </div>

              <div className="border-t border-border pt-4 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="gold"
                  disabled={saveCategoryMutation.isPending}
                  className="gap-2"
                >
                  {saveCategoryMutation.isPending && <Loader2 className="size-4 animate-spin" />}
                  Save Category
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
