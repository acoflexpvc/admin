-- ==============================================================================
-- Acoflex CMS: Homepage Hero Banner (shared content + 1-4 rotating images)
-- Migration: 20261023000001_home_hero_banner.sql
--
-- Forward-only and additive. It does not drop, rename or rewrite anything:
--   * The homepage hero text (kicker, title, lede, cta_primary, cta_secondary)
--     already lives once in page_content.content->'hero' with draft/published
--     versions. The banner images are stored next to it in the same object:
--       hero.banner_enabled  boolean
--       hero.banner_images   [{ id, desktop_image, mobile_image, alt }]  (max 4)
--     so the existing Save Draft / publish_page() workflow covers them and
--     there is a single source of truth for the shared text.
--   * public.hero_slides and public.published_hero_slides are left in place
--     (empty in production when this was written) so nothing that still
--     references them breaks. The website no longer reads them.
--   * Hero uploads now land in a private "hero-uploads" bucket instead of the
--     public website-media/tmp/ folder; validate-hero-image copies verified
--     images to website-media/hero/ and deletes the temporary object.
-- ==============================================================================

-- 1. Validate the homepage banner on every write to page_content.
-- Runs for drafts and for the published row written by publish_page(), so an
-- incomplete banner can neither be saved nor published.
CREATE OR REPLACE FUNCTION public.validate_home_hero_banner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  hero jsonb;
  images jsonb;
  img jsonb;
  cta jsonb;
  image_count int := 0;
BEGIN
  IF NEW.page_slug <> 'home' THEN
    RETURN NEW;
  END IF;

  hero := NEW.content -> 'hero';
  IF hero IS NULL OR jsonb_typeof(hero) <> 'object' THEN
    RETURN NEW;
  END IF;

  IF hero ? 'banner_enabled' AND jsonb_typeof(hero -> 'banner_enabled') <> 'boolean' THEN
    RAISE EXCEPTION 'Hero banner setting "banner_enabled" must be true or false.';
  END IF;

  images := hero -> 'banner_images';
  IF images IS NOT NULL AND jsonb_typeof(images) <> 'null' THEN
    IF jsonb_typeof(images) <> 'array' THEN
      RAISE EXCEPTION 'Hero banner images must be a list.';
    END IF;
    image_count := jsonb_array_length(images);
  END IF;

  IF image_count > 4 THEN
    RAISE EXCEPTION 'The homepage banner can show at most 4 images (found %).', image_count;
  END IF;

  IF COALESCE((hero ->> 'banner_enabled')::boolean, false) AND image_count = 0 THEN
    RAISE EXCEPTION 'The homepage banner needs at least one image. Add an image or switch the banner images off.';
  END IF;

  IF image_count > 0 THEN
    FOR img IN SELECT value FROM jsonb_array_elements(images) LOOP
      IF jsonb_typeof(img) <> 'object'
         OR jsonb_typeof(img -> 'desktop_image') IS DISTINCT FROM 'string'
         OR NOT COALESCE(public.is_valid_hero_image_url(img ->> 'desktop_image'), false) THEN
        RAISE EXCEPTION 'Every banner image needs a desktop image uploaded through the banner image uploader.';
      END IF;
      IF img ? 'mobile_image' AND jsonb_typeof(img -> 'mobile_image') <> 'null'
         AND (jsonb_typeof(img -> 'mobile_image') <> 'string'
              OR NOT COALESCE(public.is_valid_hero_image_url(img ->> 'mobile_image'), false)) THEN
        RAISE EXCEPTION 'Banner mobile images must be uploaded through the banner image uploader.';
      END IF;
      IF img ? 'alt' AND jsonb_typeof(img -> 'alt') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'Banner image descriptions must be text.';
      END IF;
      IF char_length(COALESCE(img ->> 'alt', '')) > 250 THEN
        RAISE EXCEPTION 'Banner image descriptions must be 250 characters or fewer.';
      END IF;
    END LOOP;
  END IF;

  -- Shared CTA links: "/path" or "https://..." only (same rule as the hero slide RPCs).
  FOR cta IN SELECT hero -> k FROM unnest(ARRAY['cta_primary', 'cta_secondary']) AS k LOOP
    IF cta IS NOT NULL AND jsonb_typeof(cta) = 'object'
       AND jsonb_typeof(cta -> 'to') = 'string' AND (cta ->> 'to') <> ''
       AND NOT public.is_valid_cta_url(cta ->> 'to') THEN
      RAISE EXCEPTION 'Button links must start with "/" (a page on this website) or "https://".';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Trigger functions must not be exposed as public RPC endpoints
REVOKE EXECUTE ON FUNCTION public.validate_home_hero_banner() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_home_hero_banner ON public.page_content;
CREATE TRIGGER trg_validate_home_hero_banner
BEFORE INSERT OR UPDATE ON public.page_content
FOR EACH ROW
EXECUTE FUNCTION public.validate_home_hero_banner();

-- 2. Private bucket for temporary hero uploads.
-- Not public: nothing in it is reachable without an admin session. Only the
-- validate-hero-image Edge Function (service role) reads the bytes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hero-uploads',
  'hero-uploads',
  false,
  5242880, -- 5 MB
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Admins upload hero temp files" ON storage.objects;
CREATE POLICY "Admins upload hero temp files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'hero-uploads'
  AND starts_with(name, 'tmp/')
  AND public.is_admin()
);

DROP POLICY IF EXISTS "Admins read hero temp files" ON storage.objects;
CREATE POLICY "Admins read hero temp files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'hero-uploads'
  AND public.is_admin()
);

DROP POLICY IF EXISTS "Admins delete hero temp files" ON storage.objects;
CREATE POLICY "Admins delete hero temp files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'hero-uploads'
  AND public.is_admin()
);

-- 3. Document the superseded slide table (kept for compatibility, not dropped).
COMMENT ON TABLE public.hero_slides IS
  'Deprecated by 20261023000001_home_hero_banner.sql: homepage banner images now live in page_content (home).hero.banner_images. Kept for backward compatibility; not read by the website.';

-- End of migration
