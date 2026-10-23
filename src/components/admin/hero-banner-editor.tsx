import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Eye,
  Monitor,
  Plus,
  Smartphone,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageUploadCard } from "@/components/admin/image-upload-card";
import { UnsavedPill } from "@/components/admin/publish-state-badge";
import { cn } from "@/lib/utils";
import { deleteUnusedHeroImage } from "@/lib/hero-image";
import {
  MAX_BANNER_IMAGES,
  bannerIsLive,
  newBannerImage,
  readBannerImages,
  type BannerImage,
  type HeroCta,
  type HomeHero,
} from "@/lib/hero-banner";
import { images as siteImages } from "@/lib/site-data";

/**
 * "Homepage Hero Banner" section of the Home page editor. Edits the shared
 * text once and manages 1–4 rotating images that all sit under that text.
 * Everything is held in the page's working copy and saved with Save Draft /
 * Publish Changes, like the rest of the page.
 */
export function HeroBannerEditor({
  hero,
  publishedHero,
  protectedUrls,
  isDirty,
  onChange,
  onBusyChange,
}: {
  hero: HomeHero;
  /** The live version, to show what visitors currently see. */
  publishedHero: HomeHero | null;
  /** Image URLs used by the saved draft or the live page; never deleted from storage. */
  protectedUrls: ReadonlySet<string>;
  isDirty: boolean;
  /** Receives an updater so slow uploads never overwrite edits made meanwhile. */
  onChange: (update: (hero: HomeHero) => HomeHero) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const images = readBannerImages(hero);
  // Latest hero for callbacks that finish after an upload (they must not use stale props).
  const heroRef = useRef(hero);
  heroRef.current = hero;
  const currentImage = (id: string) => readBannerImages(heroRef.current).find((i) => i.id === id);
  const enabled = hero.banner_enabled === true;
  const [previewOpen, setPreviewOpen] = useState(false);

  // Images uploaded while this editor is open; only these may be cleaned up on remove/replace.
  const sessionUploads = useRef(new Set<string>());
  const discard = (url: string | null) => {
    if (url && sessionUploads.current.has(url) && !protectedUrls.has(url)) {
      sessionUploads.current.delete(url);
      void deleteUnusedHeroImage(url);
    }
  };

  // Uploads in progress, per card, so Save/Publish can wait for them.
  const [busyCards, setBusyCards] = useState<ReadonlySet<string>>(new Set());
  const setCardBusy = useCallback((key: string, busy: boolean) => {
    setBusyCards((prev) => {
      if (prev.has(key) === busy) return prev;
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  useEffect(() => onBusyChange(busyCards.size > 0), [busyCards, onBusyChange]);

  const setField = (field: "kicker" | "title" | "lede", value: string) =>
    onChange((h) => ({ ...h, [field]: value }));
  const setCta = (key: "cta_primary" | "cta_secondary", field: keyof HeroCta, value: string) =>
    onChange((h) => ({ ...h, [key]: { ...h[key], [field]: value } }));
  const updateImages = (fn: (current: BannerImage[]) => BannerImage[]) =>
    onChange((h) => ({ ...h, banner_images: fn(readBannerImages(h)) }));
  const updateImage = (id: string, patch: Partial<BannerImage>) =>
    updateImages((list) => list.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  const move = (id: string, delta: -1 | 1) =>
    updateImages((list) => {
      const from = list.findIndex((img) => img.id === id);
      const to = from + delta;
      const item = list[from];
      if (!item || to < 0 || to >= list.length) return list;
      const next = [...list];
      next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  const removeImage = (id: string) => {
    const img = currentImage(id);
    discard(img?.desktop_image || null);
    discard(img?.mobile_image ?? null);
    setCardBusy(`${id}:desktop`, false);
    setCardBusy(`${id}:mobile`, false);
    updateImages((list) => list.filter((i) => i.id !== id));
  };

  const canAdd = images.length < MAX_BANNER_IMAGES;
  const liveNow = publishedHero ? bannerIsLive(publishedHero) : false;
  const liveCount = publishedHero ? readBannerImages(publishedHero).length : 0;

  return (
    <div
      id="hero-banner"
      className="scroll-mt-6 space-y-6 rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6"
    >
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">Homepage Hero Banner</h2>
            {isDirty && <UnsavedPill />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            The large banner at the top of the homepage. The heading, text and buttons are written
            once and stay the same while up to {MAX_BANNER_IMAGES} images rotate behind them.
          </p>
          <p className="mt-2 text-xs font-medium text-foreground">
            Live website now:{" "}
            <span className="font-normal text-muted-foreground">
              {liveNow
                ? `${liveCount} rotating banner ${liveCount === 1 ? "image" : "images"}`
                : "standard factory photo"}
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setPreviewOpen(true)}
          className="min-h-10 shrink-0 self-start"
        >
          <Eye /> Preview Banner
        </Button>
      </div>

      {/* Shared text */}
      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          Banner text{" "}
          <span className="font-normal text-muted-foreground">(shared by all images)</span>
        </legend>
        <div className="space-y-1.5">
          <Label htmlFor="hero-kicker">Small tagline above the heading</Label>
          <Input
            id="hero-kicker"
            value={hero.kicker ?? ""}
            onChange={(e) => setField("kicker", e.target.value)}
            placeholder="e.g. Pipe manufacturer · Ambala, Haryana"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hero-title">Main heading *</Label>
          <Input
            id="hero-title"
            required
            value={hero.title ?? ""}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="Main headline"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hero-lede">Description</Label>
          <Textarea
            id="hero-lede"
            rows={3}
            value={hero.lede ?? ""}
            onChange={(e) => setField("lede", e.target.value)}
            placeholder="One or two sentences under the heading"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              ["cta_primary", "Main button", "Explore products", "/products"],
              ["cta_secondary", "Second button", "Contact sales", "/contact"],
            ] as const
          ).map(([key, name, labelHint, urlHint]) => (
            <div key={key} className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-sm font-medium text-foreground">{name}</p>
              <div className="space-y-1.5">
                <Label htmlFor={`${key}-label`}>Button text</Label>
                <Input
                  id={`${key}-label`}
                  value={hero[key]?.label ?? ""}
                  onChange={(e) => setCta(key, "label", e.target.value)}
                  placeholder={labelHint}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${key}-to`}>Button link</Label>
                <Input
                  id={`${key}-to`}
                  value={hero[key]?.to ?? ""}
                  onChange={(e) => setCta(key, "to", e.target.value)}
                  placeholder={urlHint}
                  inputMode="url"
                  aria-describedby="cta-link-help"
                />
              </div>
            </div>
          ))}
        </div>
        <p id="cta-link-help" className="text-xs text-muted-foreground">
          Links start with “/” for a page on this website (e.g. /products) or “https://” for another
          website.
        </p>
      </fieldset>

      {/* Images */}
      <fieldset className="space-y-4 border-t border-border pt-6">
        <legend className="sr-only">Banner images</legend>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="min-w-0">
            <Label htmlFor="banner-enabled" className="text-sm font-semibold text-foreground">
              Show rotating banner images
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {enabled
                ? "On — the images below rotate behind the banner text."
                : "Off — the homepage shows the standard factory photo. Your images are kept."}
            </p>
          </div>
          <Switch
            id="banner-enabled"
            checked={enabled}
            onCheckedChange={(checked) =>
              onChange((h) => {
                const list = readBannerImages(h);
                return {
                  ...h,
                  banner_enabled: checked,
                  banner_images: checked && list.length === 0 ? [newBannerImage()] : list,
                };
              })
            }
          />
        </div>

        <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4 text-xs leading-relaxed text-foreground">
          <p className="font-semibold">Image requirements</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
            <li>
              One image is enough. You can add up to {MAX_BANNER_IMAGES}; they rotate in the order
              shown.
            </li>
            <li>Desktop image: wide, about 1920 × 700 px (at least 1600 × 580 px).</li>
            <li>Mobile image (optional): tall, about 900 × 1200 px (at least 750 × 1000 px).</li>
            <li>JPEG, PNG or WebP, up to 5 MB each. Images are optimised automatically.</li>
          </ul>
        </div>

        {images.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm font-medium text-foreground">No banner images yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add an image to use your own photos instead of the standard factory photo.
            </p>
          </div>
        ) : (
          <ol className="space-y-4">
            {images.map((img, index) => {
              const isOnly = images.length === 1;
              const removeBlocked = enabled && isOnly;
              return (
                <li
                  key={img.id}
                  className="rounded-xl border border-border bg-muted/20 p-4"
                  aria-label={`Banner image ${index + 1} of ${images.length}`}
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      Image {index + 1}
                      {index === 0 && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          shown first
                        </span>
                      )}
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={index === 0}
                        onClick={() => move(img.id, -1)}
                        aria-label={`Move image ${index + 1} up`}
                        title="Move up"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={index === images.length - 1}
                        onClick={() => move(img.id, 1)}
                        aria-label={`Move image ${index + 1} down`}
                        title="Move down"
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={removeBlocked}
                        onClick={() => removeImage(img.id)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-describedby={removeBlocked ? `remove-help-${img.id}` : undefined}
                      >
                        <Trash2 /> Remove image
                      </Button>
                    </div>
                  </div>
                  {removeBlocked && (
                    <p
                      id={`remove-help-${img.id}`}
                      className="-mt-2 mb-4 text-xs text-muted-foreground"
                    >
                      The banner needs at least one image. To go back to the standard factory photo,
                      switch “Show rotating banner images” off.
                    </p>
                  )}

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <ImageUploadCard
                      kind="desktop"
                      value={img.desktop_image || null}
                      onUploaded={(uploaded) => {
                        sessionUploads.current.add(uploaded.url);
                        discard(currentImage(img.id)?.desktop_image || null);
                        updateImage(img.id, { desktop_image: uploaded.url });
                      }}
                      onBusyChange={(busy) => setCardBusy(`${img.id}:desktop`, busy)}
                    />
                    <div className="lg:w-64">
                      <ImageUploadCard
                        kind="mobile"
                        optional
                        value={img.mobile_image}
                        onUploaded={(uploaded) => {
                          sessionUploads.current.add(uploaded.url);
                          discard(currentImage(img.id)?.mobile_image ?? null);
                          updateImage(img.id, { mobile_image: uploaded.url });
                        }}
                        onRemove={() => {
                          discard(currentImage(img.id)?.mobile_image ?? null);
                          updateImage(img.id, { mobile_image: null });
                        }}
                        onBusyChange={(busy) => setCardBusy(`${img.id}:mobile`, busy)}
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-1.5">
                    <Label htmlFor={`alt-${img.id}`}>Image description (for screen readers)</Label>
                    <Input
                      id={`alt-${img.id}`}
                      value={img.alt}
                      maxLength={250}
                      onChange={(e) => updateImage(img.id, { alt: e.target.value })}
                      placeholder="e.g. Pipe extrusion line at the Ambala plant"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!canAdd}
            onClick={() =>
              onChange((h) => {
                const list = readBannerImages(h);
                return list.length >= MAX_BANNER_IMAGES
                  ? h
                  : { ...h, banner_enabled: true, banner_images: [...list, newBannerImage()] };
              })
            }
            className="min-h-10"
          >
            <Plus /> Add Image
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {canAdd
              ? `${images.length} of ${MAX_BANNER_IMAGES} images used`
              : `Maximum of ${MAX_BANNER_IMAGES} images reached`}
          </span>
        </div>
      </fieldset>

      <HeroBannerPreview open={previewOpen} onOpenChange={setPreviewOpen} hero={hero} />
    </div>
  );
}

/**
 * Local, admin-only preview of the working copy. Nothing is saved or exposed
 * publicly; it mirrors the homepage hero layout closely enough to judge
 * cropping and legibility.
 */
function HeroBannerPreview({
  open,
  onOpenChange,
  hero,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hero: HomeHero;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [index, setIndex] = useState(0);
  const usable = readBannerImages(hero).filter((img) => img.desktop_image);
  const showImages = hero.banner_enabled === true && usable.length > 0;
  const count = showImages ? usable.length : 1;
  const current = showImages ? usable[Math.min(index, usable.length - 1)] : undefined;
  const src =
    current && device === "mobile" && current.mobile_image
      ? current.mobile_image
      : (current?.desktop_image ??
        (device === "mobile" ? siteImages.factoryHeroMobile : siteImages.factoryWide));
  const mobile = device === "mobile";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Banner preview</DialogTitle>
          <DialogDescription>
            Shows your current, unsaved changes. Visitors will not see them until you publish.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Preview size">
          {(
            [
              ["desktop", Monitor, "Desktop"],
              ["mobile", Smartphone, "Mobile"],
            ] as const
          ).map(([value, Icon, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={device === value ? "default" : "outline"}
              aria-pressed={device === value}
              onClick={() => setDevice(value)}
            >
              <Icon /> {label}
            </Button>
          ))}
          {!showImages && (
            <span className="text-xs text-muted-foreground">
              Banner images are off, so the standard factory photo is shown.
            </span>
          )}
        </div>

        <div className={cn("mx-auto w-full", mobile ? "max-w-[22rem]" : "")}>
          <div
            className={cn(
              "relative overflow-hidden rounded-lg bg-forest text-white",
              mobile ? "aspect-[9/16]" : "aspect-[1920/700]",
            )}
          >
            <img
              src={src}
              alt={current?.alt ?? ""}
              className="absolute inset-0 size-full object-cover"
            />
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--forest)_92%,transparent)_0%,color-mix(in_oklab,var(--forest)_78%,transparent)_60%,color-mix(in_oklab,var(--forest)_35%,transparent)_100%)]"
            />
            <div
              className={cn(
                "relative flex h-full flex-col justify-center",
                mobile ? "p-5" : "w-[60%] p-[4%]",
              )}
            >
              {hero.kicker && (
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/80 sm:text-xs">
                  {hero.kicker}
                </p>
              )}
              <p
                className={cn(
                  "mt-2 font-display font-semibold leading-tight break-words",
                  mobile ? "text-2xl" : "text-lg sm:text-2xl lg:text-4xl",
                )}
              >
                {hero.title || "Main heading"}
              </p>
              {hero.lede && (
                <p className="mt-2 line-clamp-4 text-xs text-white/85 sm:text-sm">{hero.lede}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {hero.cta_primary?.label && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-forest-deep">
                    {hero.cta_primary.label} <ArrowRight className="size-3.5" />
                  </span>
                )}
                {hero.cta_secondary?.label && (
                  <span className="inline-flex items-center rounded-md border border-white/35 px-3 py-1.5 text-xs font-semibold">
                    {hero.cta_secondary.label}
                  </span>
                )}
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-gold" />
          </div>
        </div>

        {count > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous image"
              onClick={() => setIndex((i) => (i - 1 + count) % count)}
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm text-muted-foreground" aria-live="polite">
              Image {Math.min(index, count - 1) + 1} of {count}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next image"
              onClick={() => setIndex((i) => (i + 1) % count)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
