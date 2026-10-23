import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Save, Send, Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { StatusBanner, type StatusMessage } from "@/components/admin/status-banner";
import { PublishStateBadge, UnsavedPill } from "@/components/admin/publish-state-badge";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { HeroBannerEditor } from "@/components/admin/hero-banner-editor";
import { getErrorMessage } from "@/lib/errors";
import { publicSiteUrl } from "@/lib/site-url";
import { readBannerImages, readHomeHero, validateHomeHero, type HomeHero } from "@/lib/hero-banner";

export const Route = createFileRoute("/admin/pages/$slug")({
  head: () => ({
    meta: [{ title: `Edit Page — Acoflex` }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminPageDetail,
});

type Content = Record<string, unknown>;

interface PageContentRecord {
  content: Content;
  /** Published content, used to show what visitors see now. */
  publishedContent: Content | null;
  /** True when a saved draft differs from the live page (pages.has_unpublished_changes). */
  hasUnpublishedChanges: boolean;
}

const pageTitles: Record<string, string> = {
  home: "Home Page",
  about: "About Us",
  products: "Products Overview",
  manufacturing: "Manufacturing Plant",
  quality: "Quality & Testing",
  infrastructure: "Infrastructure",
  dealers: "Dealers & Distributors",
  faq: "Frequently Asked Questions",
  resources: "Resources & Brochures",
  contact: "Contact Us & Location",
};

const sectionLabels: Record<string, string> = {
  strengths: "Key Strengths & Features",
  benefits: "Dealer & Distributor Benefits",
  facilities: "Infrastructure Facilities",
  stages: "Quality Testing Stages",
  faqs: "Questions & Answers (FAQs)",
  markets: "Market Sectors",
  process_steps: "Production Steps",
  plant_areas: "Plant Areas",
  items: "Brochure & Resource Items",
};

const homeTeasers = [
  ["about_teaser", '"About Acoflex" Homepage Section'],
  ["quality_teaser", '"Quality & Testing" Homepage Section'],
  ["dealers_teaser", '"Become a Dealer" Homepage Section'],
] as const;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const asText = (value: unknown) => (typeof value === "string" ? value : "");

/** Drops banner image cards the client added but never filled, so they cannot block saving. */
function prepareForSave(content: Content): Content {
  const hero = readHomeHero(content);
  if (!Array.isArray(hero.banner_images)) return content;
  const images = readBannerImages(hero).filter(
    (img) => img.desktop_image || img.mobile_image || img.alt.trim(),
  );
  return { ...content, hero: { ...hero, banner_images: images } };
}

/** URLs of every banner image in a page version. */
function bannerUrls(content: Content | null | undefined): string[] {
  if (!content) return [];
  return readBannerImages(readHomeHero(content)).flatMap((img) =>
    [img.desktop_image, img.mobile_image].filter((url): url is string => !!url),
  );
}

function AdminPageDetail() {
  const { slug } = Route.useParams();
  const queryClient = useQueryClient();
  const isHome = slug === "home";

  const [contentPayload, setContentPayload] = useState<Content>({});
  const [initialContent, setInitialContent] = useState<Content>({});
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [uploading, setUploading] = useState(false);

  // 1. Fetch current content (draft preferred, published fallback) plus the live version
  const {
    data: pageData,
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery<PageContentRecord>({
    queryKey: ["admin_page_content", slug],
    queryFn: async () => {
      if (!supabase) throw new Error("Database connection is not available.");

      const [versions, page] = await Promise.all([
        supabase.from("page_content").select("version, content").eq("page_slug", slug),
        supabase.from("pages").select("has_unpublished_changes").eq("slug", slug).maybeSingle(),
      ]);
      if (versions.error) throw versions.error;
      if (page.error) throw page.error;

      const rows = (versions.data ?? []) as { version: string; content: Content }[];
      const draft = rows.find((row) => row.version === "draft");
      const published = rows.find((row) => row.version === "published");
      const current = draft ?? published;
      if (!current) throw new Error(`No content found for page: ${slug}`);
      return {
        content: current.content,
        publishedContent: published?.content ?? null,
        hasUnpublishedChanges: Boolean(page.data?.has_unpublished_changes),
      };
    },
  });

  useEffect(() => {
    if (pageData?.content) {
      setContentPayload(pageData.content);
      setInitialContent(pageData.content);
    }
  }, [pageData]);

  // Compute if there are unsaved working modifications
  const isDirty = useMemo(() => {
    if (!initialContent || Object.keys(initialContent).length === 0) return false;
    return JSON.stringify(contentPayload) !== JSON.stringify(initialContent);
  }, [contentPayload, initialContent]);

  // The "Homepage Banner" menu link opens this page at #hero-banner; jump there once it renders.
  const loaded = Boolean(pageData);
  useEffect(() => {
    if (loaded && window.location.hash === "#hero-banner") {
      document.getElementById("hero-banner")?.scrollIntoView();
    }
  }, [loaded]);

  // Prevent accidental tab closure / navigation when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
      return undefined;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const saveDraft = async (content: Content) => {
    if (!supabase) throw new Error("Database connection is not available.");
    const { error: upsertErr } = await supabase.from("page_content").upsert(
      {
        page_slug: slug,
        version: "draft",
        content,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "page_slug,version" },
    );
    if (upsertErr) throw upsertErr;
  };

  // 2. Mutation to Save Draft
  const saveDraftMutation = useMutation({
    mutationFn: async (updatedContent: Content) => {
      if (!supabase) throw new Error("Database connection is not available.");
      await saveDraft(updatedContent);

      const { error: pageUpdateErr } = await supabase
        .from("pages")
        .update({
          has_unpublished_changes: true,
          updated_at: new Date().toISOString(),
        })
        .eq("slug", slug);

      if (pageUpdateErr) throw pageUpdateErr;
      return updatedContent;
    },
    onSuccess: (saved) => {
      setContentPayload(saved);
      setInitialContent(saved);
      setStatusMessage({
        type: "success",
        text: "Changes saved as draft. The live website has not changed. When you are ready, click 'Publish Changes'.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin_page_content", slug] });
      queryClient.invalidateQueries({ queryKey: ["admin_pages_registry"] });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: `Unable to save changes: ${getErrorMessage(err)}`,
      });
    },
  });

  // 3. Mutation to Publish Page via RPC (saves the working copy first; stops if that fails)
  const publishMutation = useMutation({
    mutationFn: async (updatedContent: Content) => {
      if (!supabase) throw new Error("Database connection is not available.");
      await saveDraft(updatedContent);

      const { error: rpcErr } = await supabase.rpc("publish_page", {
        target_slug: slug,
      });

      if (rpcErr) throw rpcErr;
      return updatedContent;
    },
    onSuccess: (published) => {
      setContentPayload(published);
      setInitialContent(published);
      setStatusMessage({
        type: "success",
        text: "Page published. The live website now shows your latest changes.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin_page_content", slug] });
      queryClient.invalidateQueries({ queryKey: ["admin_pages_registry"] });
      queryClient.invalidateQueries({ queryKey: ["page-content", slug, "published"] });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: `Unable to publish page: ${getErrorMessage(err)}`,
      });
    },
  });

  const busy = saveDraftMutation.isPending || publishMutation.isPending;

  /** Returns the content to save, or null after showing why it cannot be saved yet. */
  const readyContent = (): Content | null => {
    if (uploading) {
      setStatusMessage({
        type: "info",
        text: "Please wait for the image upload to finish before saving.",
      });
      return null;
    }
    const content = prepareForSave(contentPayload);
    if (isHome) {
      const problems = validateHomeHero(readHomeHero(content));
      if (problems.length > 0) {
        setStatusMessage({ type: "error", text: problems.join(" ") });
        document.getElementById("hero-banner")?.scrollIntoView({ behavior: "smooth" });
        return null;
      }
    }
    return content;
  };

  const handleSaveDraft = (e?: React.FormEvent) => {
    e?.preventDefault();
    setStatusMessage(null);
    const content = readyContent();
    if (content) saveDraftMutation.mutate(content);
  };

  const handlePublish = () => {
    setStatusMessage(null);
    if (readyContent()) setConfirmPublish(true);
  };

  // Safe field updater helpers
  const handleHeroChange = (field: string, value: string) => {
    setContentPayload((prev) => ({
      ...prev,
      hero: { ...asRecord(prev["hero"]), [field]: value },
    }));
  };

  const handleHomeHeroChange = useCallback((update: (hero: HomeHero) => HomeHero) => {
    setContentPayload((prev) => ({ ...prev, hero: update(readHomeHero(prev)) }));
  }, []);

  const handleTeaserChange = (sectionKey: string, field: string, value: string) => {
    setContentPayload((prev) => ({
      ...prev,
      [sectionKey]: { ...asRecord(prev[sectionKey]), [field]: value },
    }));
  };

  const handleArrayItemChange = (arrayKey: string, index: number, field: string, value: string) => {
    setContentPayload((prev) => {
      const current = prev[arrayKey];
      const arr = Array.isArray(current) ? [...(current as Record<string, unknown>[])] : [];
      const item = arr[index];
      if (item) arr[index] = { ...item, [field]: value };
      return { ...prev, [arrayKey]: arr };
    });
  };

  // Banner images referenced by the saved draft or the live page must never be deleted.
  const protectedUrls = useMemo(
    () => new Set([...bannerUrls(initialContent), ...bannerUrls(pageData?.publishedContent)]),
    [initialContent, pageData?.publishedContent],
  );

  // Check section dirty flags for helpful UX
  const isSectionDirty = (sectionKey: string): boolean =>
    JSON.stringify(contentPayload[sectionKey]) !== JSON.stringify(initialContent[sectionKey]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center" role="status">
        <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">Loading page content…</span>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-destructive">
        <p className="font-semibold">Unable to load page content</p>
        <p className="text-sm mt-1">{getErrorMessage(fetchError)}</p>
        <Button onClick={() => refetch()} variant="outline" className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  const hero = asRecord(contentPayload["hero"]);
  const publicPath = isHome ? "/" : `/${slug}`;
  const friendlyName = pageTitles[slug] || slug;

  const actionButtons = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => handleSaveDraft()}
        disabled={busy}
        className="gap-2 font-medium"
      >
        {saveDraftMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
        {saveDraftMutation.isPending ? "Saving…" : "Save Draft"}
      </Button>
      <Button
        type="button"
        variant="gold"
        onClick={handlePublish}
        disabled={busy}
        className="gap-2 font-semibold shadow-xs"
      >
        {publishMutation.isPending ? <Loader2 className="animate-spin" /> : <Send />}
        {publishMutation.isPending ? "Publishing…" : "Publish Changes"}
      </Button>
    </>
  );

  return (
    <div className="space-y-6">
      {/* Top Header & Friendly Actions */}
      <div className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link
            to="/admin"
            className="mb-2 inline-flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to All Pages
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Edit {friendlyName}
            </h1>
            <PublishStateBadge
              isDirty={isDirty}
              hasDraft={pageData?.hasUnpublishedChanges ?? false}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button asChild variant="outline" className="gap-1.5">
            <a href={publicSiteUrl(publicPath)} target="_blank" rel="noreferrer">
              <ExternalLink /> View Live Page
            </a>
          </Button>
          {actionButtons}
        </div>
      </div>

      <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage(null)} />

      {/* Main Form Fields */}
      <form onSubmit={handleSaveDraft} className="space-y-6">
        {isHome ? (
          <HeroBannerEditor
            hero={readHomeHero(contentPayload)}
            publishedHero={
              pageData?.publishedContent ? readHomeHero(pageData.publishedContent) : null
            }
            protectedUrls={protectedUrls}
            isDirty={isSectionDirty("hero")}
            onChange={handleHomeHeroChange}
            onBusyChange={setUploading}
          />
        ) : (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Top Banner & Headline</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The main title and introductory paragraph visible at the top of this page.
                </p>
              </div>
              {isSectionDirty("hero") && <UnsavedPill />}
            </div>

            <div className="space-y-4">
              {hero["kicker"] !== undefined && (
                <div className="space-y-1.5">
                  <Label htmlFor="hero-kicker">Small Top Tagline / Category Tag</Label>
                  <Input
                    id="hero-kicker"
                    value={asText(hero["kicker"])}
                    onChange={(e) => handleHeroChange("kicker", e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="hero-title">Main Page Title *</Label>
                <Input
                  id="hero-title"
                  required
                  value={asText(hero["title"])}
                  onChange={(e) => handleHeroChange("title", e.target.value)}
                  placeholder="Page Title"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="hero-intro">Introductory Description *</Label>
                <Textarea
                  id="hero-intro"
                  rows={3}
                  required
                  value={asText(hero["lede"]) || asText(hero["intro"])}
                  onChange={(e) =>
                    handleHeroChange(hero["lede"] !== undefined ? "lede" : "intro", e.target.value)
                  }
                  placeholder="Introductory paragraph..."
                />
              </div>
            </div>
          </div>
        )}

        {/* Collapsible Page Sections (Teasers & Content Blocks) */}
        <div className="space-y-4">
          {isHome && (
            <Accordion type="multiple" className="w-full space-y-4 border-none">
              {homeTeasers.map(([key, label]) => {
                if (!contentPayload[key]) return null;
                const teaser = asRecord(contentPayload[key]);
                return (
                  <AccordionItem
                    key={key}
                    value={key}
                    className="rounded-xl border border-border bg-card px-4 py-1 shadow-xs sm:px-6"
                  >
                    <AccordionTrigger className="py-4 text-left hover:no-underline">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-base font-semibold text-foreground">{label}</span>
                        {isSectionDirty(key) && <UnsavedPill />}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pb-4 pt-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`${key}-title`}>Section Title</Label>
                        <Input
                          id={`${key}-title`}
                          value={asText(teaser["title"])}
                          onChange={(e) => handleTeaserChange(key, "title", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${key}-copy`}>Description</Label>
                        <Textarea
                          id={`${key}-copy`}
                          rows={3}
                          value={asText(teaser["copy"])}
                          onChange={(e) => handleTeaserChange(key, "copy", e.target.value)}
                        />
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}

          {/* Structured Lists / Items in Accordion Cards */}
          <Accordion type="multiple" className="w-full space-y-4 border-none">
            {Object.keys(contentPayload).map((key) => {
              const val = contentPayload[key];
              if (!Array.isArray(val) || key === "services") return null;
              const dirty = isSectionDirty(key);

              return (
                <AccordionItem
                  key={key}
                  value={key}
                  className="rounded-xl border border-border bg-card px-4 py-1 shadow-xs sm:px-6"
                >
                  <AccordionTrigger className="py-4 text-left hover:no-underline">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-base font-semibold text-foreground">
                        {sectionLabels[key] ?? key}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        ({val.length} {val.length === 1 ? "item" : "items"})
                      </span>
                      {dirty && <UnsavedPill />}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pb-4 pt-2">
                    {val.map((itemVal: unknown, idx: number) => {
                      if (typeof itemVal !== "object" || itemVal === null) return null;
                      const item = itemVal as Record<string, string | undefined>;
                      const fieldId = (field: string) => `${key}-${idx}-${field}`;

                      return (
                        <div
                          key={idx}
                          className="space-y-3 rounded-lg border border-border bg-muted/30 p-4"
                        >
                          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Item #{idx + 1}
                          </span>

                          {item["question"] !== undefined && (
                            <div className="space-y-1">
                              <Label htmlFor={fieldId("question")}>Question</Label>
                              <Input
                                id={fieldId("question")}
                                value={item["question"] || ""}
                                onChange={(e) =>
                                  handleArrayItemChange(key, idx, "question", e.target.value)
                                }
                              />
                            </div>
                          )}

                          {item["answer"] !== undefined && (
                            <div className="space-y-1">
                              <Label htmlFor={fieldId("answer")}>Answer</Label>
                              <Textarea
                                id={fieldId("answer")}
                                rows={2}
                                value={item["answer"] || ""}
                                onChange={(e) =>
                                  handleArrayItemChange(key, idx, "answer", e.target.value)
                                }
                              />
                            </div>
                          )}

                          {item["title"] !== undefined && item["question"] === undefined && (
                            <div className="space-y-1">
                              <Label htmlFor={fieldId("title")}>Heading / Title</Label>
                              <Input
                                id={fieldId("title")}
                                value={item["title"] || ""}
                                onChange={(e) =>
                                  handleArrayItemChange(key, idx, "title", e.target.value)
                                }
                              />
                            </div>
                          )}

                          {item["name"] !== undefined && (
                            <div className="space-y-1">
                              <Label htmlFor={fieldId("name")}>Step Name</Label>
                              <Input
                                id={fieldId("name")}
                                value={item["name"] || ""}
                                onChange={(e) =>
                                  handleArrayItemChange(key, idx, "name", e.target.value)
                                }
                              />
                            </div>
                          )}

                          {item["note"] !== undefined && (
                            <div className="space-y-1">
                              <Label htmlFor={fieldId("note")}>Note / Details</Label>
                              <Textarea
                                id={fieldId("note")}
                                rows={2}
                                value={item["note"] || ""}
                                onChange={(e) =>
                                  handleArrayItemChange(key, idx, "note", e.target.value)
                                }
                              />
                            </div>
                          )}

                          {item["copy"] !== undefined && (
                            <div className="space-y-1">
                              <Label htmlFor={fieldId("copy")}>Description</Label>
                              <Textarea
                                id={fieldId("copy")}
                                rows={2}
                                value={item["copy"] || ""}
                                onChange={(e) =>
                                  handleArrayItemChange(key, idx, "copy", e.target.value)
                                }
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>

        {/* Contact Page Map Embed */}
        {slug === "contact" && (
          <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Google Maps Location Link
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Embed URL for displaying interactive map on the contact page.
                </p>
              </div>
              {isSectionDirty("map_embed_url") && <UnsavedPill />}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="map-url">Google Maps Embed URL</Label>
              <Input
                id="map-url"
                value={asText(contentPayload["map_embed_url"])}
                onChange={(e) =>
                  setContentPayload((prev) => ({ ...prev, map_embed_url: e.target.value }))
                }
                placeholder="https://www.google.com/maps/embed?..."
              />
            </div>
          </div>
        )}

        {/* Bottom Save & Publish Buttons */}
        <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
          {actionButtons}
        </div>
      </form>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={`Publish ${friendlyName}?`}
        description="Your changes will replace the content visitors see on the live website straight away."
        confirmLabel="Publish Changes"
        onConfirm={() => {
          const content = readyContent();
          if (content) publishMutation.mutate(content);
        }}
      />
    </div>
  );
}
