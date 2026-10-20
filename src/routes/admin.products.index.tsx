import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Boxes,
  Plus,
  Edit2,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Search,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/admin/products/")({
  head: () => ({
    meta: [
      { title: "Manage Products — Acoflex CMS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminProductsList,
});

interface ProductItem {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  full_name: string;
  system: string;
  summary: string;
  sort_order: number;
  is_published: boolean;
  image_url: string;
  updated_at: string;
  hasDraft?: boolean;
  category_name?: string;
}

function AdminProductsList() {
  const [searchQuery, setSearchQuery] = useState("");

  // 1. Fetch categories map
  const { data: categoriesMap } = useQuery<Record<string, { name: string; slug: string }>>({
    queryKey: ["admin_categories_map"],
    queryFn: async () => {
      if (!supabase) return {};
      const { data } = await supabase.from("product_categories").select("id, name, slug");
      const map: Record<string, { name: string; slug: string }> = {};
      data?.forEach((c) => {
        map[c.id] = { name: c.name, slug: c.slug };
      });
      return map;
    },
  });

  // 2. Fetch products and check product_drafts table
  const {
    data: productsList,
    isLoading,
    error,
    refetch,
  } = useQuery<ProductItem[]>({
    queryKey: ["admin_products_with_drafts"],
    queryFn: async () => {
      if (!supabase) throw new Error("Supabase client is not available.");

      // Fetch products
      const { data: prods, error: prodErr } = await supabase
        .from("products")
        .select("*")
        .order("sort_order", { ascending: true });

      if (prodErr) throw prodErr;

      // Fetch active drafts
      const { data: drafts, error: draftErr } = await supabase
        .from("product_drafts")
        .select("product_id");

      if (draftErr) throw draftErr;
      const draftSet = new Set(drafts?.map((d) => d.product_id));

      return (prods || []).map((p) => ({
        ...p,
        hasDraft: draftSet.has(p.id),
      })) as ProductItem[];
    },
  });

  const filteredProducts = productsList?.filter((p) => {
    const q = searchQuery.toLowerCase();
    const catName = categoriesMap?.[p.category_id]?.name?.toLowerCase() || "";
    return (
      p.name.toLowerCase().includes(q) ||
      p.full_name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      catName.includes(q)
    );
  });

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
        <p className="font-semibold">Failed to load product catalogue</p>
        <p className="text-sm mt-1">{(error as Error).message}</p>
        <Button onClick={() => refetch()} variant="outline" className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header and Add Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Products & Pipe Systems
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add new products, update specifications, or organize product categories.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/admin/categories">Manage Categories</Link>
          </Button>
          <Button asChild variant="gold" size="sm" className="gap-1.5 font-semibold">
            <Link to="/admin/products/new">
              <Plus className="size-4" /> Add New Product
            </Link>
          </Button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search products by name, slug or category..."
            className="pl-9"
          />
        </div>
      </div>

      {/* Products Table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">System</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Draft State</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredProducts?.map((product) => {
                const category = categoriesMap?.[product.category_id];
                const base = import.meta.env.VITE_PUBLIC_WEBSITE_URL || "https://acoflex.com";
                const publicUrl = `${base}/products/${category?.slug || "plumbing"}/${product.slug}`;

                return (
                  <tr key={product.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-foreground">{product.name}</div>
                      <div className="text-xs text-muted-foreground">{product.full_name}</div>
                      <code className="text-[11px] text-muted-foreground/80 mt-0.5 inline-block">
                        slug: {product.slug}
                      </code>
                    </td>

                    <td className="py-3 px-4">
                      <span className="text-xs font-medium text-foreground">
                        {category?.name || "Unknown"}
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      <span className="text-xs text-muted-foreground">{product.system}</span>
                    </td>

                    <td className="py-3 px-4">
                      {product.is_published ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          <CheckCircle2 className="size-3" /> Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 bg-zinc-500/10 px-2 py-0.5 rounded-full border border-zinc-500/20">
                          Unpublished
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      {product.hasDraft ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                          <Clock className="size-3" /> Draft Pending
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Up to date</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {product.is_published && (
                          <a
                            href={publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                            title="View on site"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                        <Button asChild variant="outline" size="sm" className="gap-1.5">
                          <Link to="/admin/products/$id" params={{ id: product.id }}>
                            <Edit2 className="size-3.5" /> Edit
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
