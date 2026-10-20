import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Home,
  Info,
  Factory,
  Award,
  Building2,
  Users,
  HelpCircle,
  FolderOpen,
  Mail,
  ArrowRight,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Clock,
  Package,
} from "lucide-react";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Select Page to Edit — Acoflex" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminPagesSelection,
});

interface PageItem {
  slug: string;
  title: string;
  has_unpublished_changes: boolean;
  published_at: string | null;
  updated_at: string;
}

// Map slugs to clean, plain-English names, descriptions and friendly icons
const pageMetadata: Record<
  string,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }> }
> = {
  home: {
    label: "Home Page",
    description: "Main website introduction, headline banner, and overview highlights",
    icon: Home,
  },
  about: {
    label: "About Us",
    description: "Company background, market solutions, and core corporate values",
    icon: Info,
  },
  products: {
    label: "Products Overview",
    description: "Catalogue hero header and quick customer quotation banner",
    icon: Package,
  },
  manufacturing: {
    label: "Manufacturing Plant",
    description: "Factory details, extrusion lines, and pipe fabrication process",
    icon: Factory,
  },
  quality: {
    label: "Quality & Testing",
    description: "Testing lab details, durability standards, and quality stages",
    icon: Award,
  },
  infrastructure: {
    label: "Infrastructure",
    description: "Warehouse, raw material silos, and transport logistics facilities",
    icon: Building2,
  },
  dealers: {
    label: "Dealers & Distributors",
    description: "Partner network information, dealership benefits, and inquiry section",
    icon: Users,
  },
  faq: {
    label: "Frequently Asked Questions",
    description: "Common questions and detailed answers for plumbing and pipes",
    icon: HelpCircle,
  },
  resources: {
    label: "Resources & Brochures",
    description: "Downloadable product guides, catalogue PDFs, and technical sheets",
    icon: FolderOpen,
  },
  contact: {
    label: "Contact Us & Location",
    description: "Office address, phone numbers, map location, and inquiry form header",
    icon: Mail,
  },
};

function AdminPagesSelection() {
  const {
    data: pages,
    isLoading,
    error,
    refetch,
  } = useQuery<PageItem[]>({
    queryKey: ["admin_pages_registry"],
    queryFn: async () => {
      if (!supabase) throw new Error("Database connection is not available.");
      const { data, error: err } = await supabase
        .from("pages")
        .select("*")
        .order("slug", { ascending: true });

      if (err) throw err;
      return (data || []) as PageItem[];
    },
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
        <p className="font-semibold">Unable to load pages</p>
        <p className="text-sm mt-1">{(error as Error).message}</p>
        <Button onClick={() => refetch()} variant="outline" className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  const getPublicPath = (slug: string) => {
    const base = import.meta.env.VITE_PUBLIC_WEBSITE_URL || "https://acoflex.com";
    return slug === "home" ? `${base}/` : `${base}/${slug}`;
  };

  // Pre-sort pages in natural reading order
  const orderedSlugs = [
    "home",
    "about",
    "products",
    "manufacturing",
    "quality",
    "infrastructure",
    "dealers",
    "faq",
    "resources",
    "contact",
  ];

  const sortedPages = [...(pages || [])].sort((a, b) => {
    const idxA = orderedSlugs.indexOf(a.slug);
    const idxB = orderedSlugs.indexOf(b.slug);
    return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99);
  });

  return (
    <div className="space-y-6">
      {/* Friendly Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Choose a Page to Edit</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Click on any page below to update its headings, text, or photos.
        </p>
      </div>

      {/* Clean Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sortedPages.map((page) => {
          const meta = pageMetadata[page.slug] || {
            label: page.title,
            description: "Edit page content and sections",
            icon: Home,
          };
          const Icon = meta.icon;
          const publicUrl = getPublicPath(page.slug);

          return (
            <div
              key={page.slug}
              className="group rounded-xl border border-border bg-card p-5 shadow-xs transition-all hover:border-primary/50 hover:shadow-sm flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-base text-foreground group-hover:text-primary transition-colors">
                        {meta.label}
                      </h2>
                      <div className="flex items-center gap-2 mt-0.5">
                        {page.has_unpublished_changes ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                            <Clock className="size-3" /> Draft changes waiting to publish
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="size-3" /> Published & Live
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                    title="View this page on the live website"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">{meta.description}</p>
              </div>

              <div className="pt-4 border-t border-border mt-4 flex items-center justify-end">
                <Button
                  asChild
                  size="sm"
                  variant="default"
                  className="gap-1.5 text-xs font-semibold"
                >
                  <Link to="/admin/pages/$slug" params={{ slug: page.slug }}>
                    Edit Page Content <ArrowRight className="size-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
