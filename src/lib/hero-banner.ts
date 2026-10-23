/**
 * Homepage hero banner model.
 *
 * The shared text (kicker, title, lede, two buttons) and the banner images live
 * together in page_content (home).content.hero, so the existing Save Draft /
 * Publish workflow covers both. The database enforces the same rules again in
 * public.validate_home_hero_banner() (20261023000001_home_hero_banner.sql).
 */

export const MAX_BANNER_IMAGES = 4;

export interface HeroCta {
  label?: string;
  to?: string;
}

export interface BannerImage {
  /** Stable key for React lists and reordering; not shown to the client. */
  id: string;
  /** Public URL from validate-hero-image; empty in the editor until an upload succeeds. */
  desktop_image: string;
  mobile_image: string | null;
  alt: string;
}

export interface HomeHero {
  kicker?: string;
  title?: string;
  lede?: string;
  cta_primary?: HeroCta;
  cta_secondary?: HeroCta;
  banner_enabled?: boolean;
  banner_images?: BannerImage[];
  [key: string]: unknown;
}

export const newBannerImage = (): BannerImage => ({
  id: crypto.randomUUID(),
  desktop_image: "",
  mobile_image: null,
  alt: "",
});

const asString = (value: unknown) => (typeof value === "string" ? value : "");

export function readHomeHero(content: Record<string, unknown>): HomeHero {
  const hero = content["hero"];
  return hero && typeof hero === "object" && !Array.isArray(hero) ? (hero as HomeHero) : {};
}

export function readBannerImages(hero: HomeHero): BannerImage[] {
  // Stored JSON: validate the shape instead of trusting the declared type.
  const raw: unknown = hero.banner_images;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      id: asString(item["id"]) || crypto.randomUUID(),
      desktop_image: asString(item["desktop_image"]),
      mobile_image: asString(item["mobile_image"]) || null,
      alt: asString(item["alt"]),
    }));
}

/** True when the published/draft content will show rotating images on the website. */
export function bannerIsLive(hero: HomeHero): boolean {
  return hero.banner_enabled === true && readBannerImages(hero).some((img) => img.desktop_image);
}

/** Same rule as public.is_valid_cta_url(): a site path or an https:// link. */
export const isValidCtaUrl = (url: string) => /^(https:\/\/\S+|\/\S*)$/.test(url);

/**
 * Problems that would stop the database accepting the hero, phrased for the
 * client. Empty when the hero can be saved and published.
 */
export function validateHomeHero(hero: HomeHero): string[] {
  const problems: string[] = [];
  const images = readBannerImages(hero);

  if (!asString(hero.title).trim()) problems.push("Add a main heading for the banner.");
  if (images.length > MAX_BANNER_IMAGES) {
    problems.push(`The banner can show at most ${MAX_BANNER_IMAGES} images.`);
  }
  if (hero.banner_enabled && images.length === 0) {
    problems.push(
      "The banner needs at least one image. Add an image, or switch banner images off to use the standard factory photo.",
    );
  }
  images.forEach((img, index) => {
    if (!img.desktop_image) {
      problems.push(
        `Image ${index + 1} has no desktop image yet. Upload one or remove that image.`,
      );
    }
    if (img.alt.length > 250) {
      problems.push(`The description for image ${index + 1} must be 250 characters or fewer.`);
    }
  });
  for (const [key, name] of [
    ["cta_primary", "main button"],
    ["cta_secondary", "second button"],
  ] as const) {
    const to = asString(hero[key]?.to).trim();
    if (to && !isValidCtaUrl(to)) {
      problems.push(`The ${name} link must start with "/" (a page on this website) or "https://".`);
    }
  }
  return problems;
}
