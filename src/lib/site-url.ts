const DEFAULT_PUBLIC_WEBSITE_URL = "https://acoflex-website.vercel.app";

/** Base URL of the public website, without a trailing slash. */
export const publicWebsiteUrl = (
  import.meta.env.VITE_PUBLIC_WEBSITE_URL || DEFAULT_PUBLIC_WEBSITE_URL
).replace(/\/+$/, "");

/** Absolute URL of a public website path, e.g. publicSiteUrl("/products"). */
export function publicSiteUrl(path = "/"): string {
  return `${publicWebsiteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
