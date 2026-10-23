-- ================================================================================
-- Acoflex CMS Phase 2.2: Hero Slider Table and Backend Operations
-- Migration: 20261010000006_hero_slides.sql
-- ================================================================================

-- 1. Hero Slides Table
CREATE TABLE IF NOT EXISTS public.hero_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                           -- internal name for admin reference
  desktop_image text NOT NULL,                 -- public URL from storage.assets (hero folder)
  mobile_image text,                          -- optional public URL
  heading text,
  description text,
  cta_label text,
  cta_url text,
  alt_text text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.admin_users(id),
  updated_by uuid REFERENCES public.admin_users(id)
);

-- Trigger to keep updated_at in sync
DROP TRIGGER IF EXISTS set_hero_slides_updated_at ON public.hero_slides;
CREATE TRIGGER set_hero_slides_updated_at
BEFORE UPDATE ON public.hero_slides
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- 2. Indexes
-- Unique sort order for active slides (allows duplicates for inactive drafts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_hero_slides_active_sort
ON public.hero_slides (sort_order)
WHERE is_active = true AND deleted_at IS NULL;

-- Index to quickly find active slides count
CREATE INDEX IF NOT EXISTS idx_hero_slides_active
ON public.hero_slides (is_active)
WHERE deleted_at IS NULL;

-- 3. Trigger to enforce maximum of 4 active slides
CREATE OR REPLACE FUNCTION public.check_max_active_slides()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  active_cnt int;
BEGIN
  IF (NEW.is_active) THEN
    SELECT count(*) INTO active_cnt FROM public.hero_slides
    WHERE is_active = true AND deleted_at IS NULL;
    IF active_cnt > 4 THEN
      RAISE EXCEPTION 'Maximum of 4 active hero slides exceeded.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_max_active_slides ON public.hero_slides;
CREATE TRIGGER trg_check_max_active_slides
BEFORE INSERT OR UPDATE ON public.hero_slides
FOR EACH ROW
EXECUTE FUNCTION public.check_max_active_slides();

-- 4. Row Level Security (RLS) Policies
ALTER TABLE public.hero_slides ENABLE ROW LEVEL SECURITY;

-- Admins have full access (SELECT/INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS "Admins full access to hero_slides" ON public.hero_slides;
CREATE POLICY "Admins full access to hero_slides"
ON public.hero_slides
FOR ALL
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Public can only read published, active, non‑deleted slides via a view (see below)
-- No direct SELECT on the table for public.

-- 5. Helper function to validate CTA URLs (simple whitelist)
CREATE OR REPLACE FUNCTION public.is_valid_cta_url(p_url text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF p_url ~* '^(https://[^\s]+|/[^\s]*)$' THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- Helper to validate hero image URLs (must point to hero/ folder in website-media bucket)
CREATE OR REPLACE FUNCTION public.is_valid_hero_image_url(p_url text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_url ~ '^https?://[^/]+/storage/v1/object/public/website-media/hero/[^/]+\.(jpg|jpeg|png|webp)$';
$$;

GRANT EXECUTE ON FUNCTION public.is_valid_hero_image_url(text) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.is_valid_cta_url(text) TO authenticated, service_role;

-- 6. RPC: Create Hero Slide
-- Audit columns (created_by / updated_by) are always taken from auth.uid(),
-- which public.is_admin() has just verified is a row in public.admin_users.
-- The p_created_by / p_updated_by parameters in sections 6-8 are kept only so
-- existing client calls still match these signatures; their values are ignored.
CREATE OR REPLACE FUNCTION public.rpc_create_hero_slide(
  p_name text,
  p_desktop_image text,
  p_mobile_image text,
  p_heading text,
  p_description text,
  p_cta_label text,
  p_cta_url text,
  p_alt_text text,
  p_sort_order int,
  p_is_active boolean,
  p_created_by uuid
) RETURNS uuid AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: Only admins can create hero slides.';
  END IF;
  IF p_cta_url IS NOT NULL AND NOT public.is_valid_cta_url(p_cta_url) THEN
    RAISE EXCEPTION 'Invalid CTA URL: %', p_cta_url;
  END IF;
  IF NOT COALESCE(public.is_valid_hero_image_url(p_desktop_image), false)
     OR (p_mobile_image IS NOT NULL AND NOT public.is_valid_hero_image_url(p_mobile_image)) THEN
    RAISE EXCEPTION 'Invalid hero image URL: images must be uploaded through the hero image validator.';
  END IF;
  INSERT INTO public.hero_slides (
    name, desktop_image, mobile_image, heading, description,
    cta_label, cta_url, alt_text, sort_order, is_active,
    created_by, updated_by
  ) VALUES (
    p_name, p_desktop_image, p_mobile_image, p_heading, p_description,
    p_cta_label, p_cta_url, p_alt_text, p_sort_order, p_is_active,
    auth.uid(), auth.uid()
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.rpc_create_hero_slide(
  text, text, text, text, text, text, text, text, int, boolean, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_create_hero_slide(
  text, text, text, text, text, text, text, text, int, boolean, uuid
) TO authenticated, service_role;

-- 7. RPC: Update Hero Slide
CREATE OR REPLACE FUNCTION public.rpc_update_hero_slide(
  p_id uuid,
  p_name text,
  p_desktop_image text,
  p_mobile_image text,
  p_heading text,
  p_description text,
  p_cta_label text,
  p_cta_url text,
  p_alt_text text,
  p_sort_order int,
  p_is_active boolean,
  p_updated_by uuid
) RETURNS void AS $$
DECLARE
  cur_desktop text;
  cur_mobile text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: Only admins can update hero slides.';
  END IF;
  IF p_cta_url IS NOT NULL AND NOT public.is_valid_cta_url(p_cta_url) THEN
    RAISE EXCEPTION 'Invalid CTA URL: %', p_cta_url;
  END IF;
  -- Unchanged image URLs are accepted so existing slides stay editable.
  SELECT desktop_image, mobile_image INTO cur_desktop, cur_mobile
  FROM public.hero_slides WHERE id = p_id;
  IF (p_desktop_image IS DISTINCT FROM cur_desktop
      AND NOT COALESCE(public.is_valid_hero_image_url(p_desktop_image), false))
     OR (p_mobile_image IS NOT NULL AND p_mobile_image IS DISTINCT FROM cur_mobile
      AND NOT public.is_valid_hero_image_url(p_mobile_image)) THEN
    RAISE EXCEPTION 'Invalid hero image URL: images must be uploaded through the hero image validator.';
  END IF;
  UPDATE public.hero_slides SET
    name = p_name,
    desktop_image = p_desktop_image,
    mobile_image = p_mobile_image,
    heading = p_heading,
    description = p_description,
    cta_label = p_cta_label,
    cta_url = p_cta_url,
    alt_text = p_alt_text,
    sort_order = p_sort_order,
    is_active = p_is_active,
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.rpc_update_hero_slide(
  uuid, text, text, text, text, text, text, text, text, int, boolean, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_update_hero_slide(
  uuid, text, text, text, text, text, text, text, text, int, boolean, uuid
) TO authenticated, service_role;

-- 8. RPC: Soft Delete Hero Slide
CREATE OR REPLACE FUNCTION public.rpc_soft_delete_hero_slide(
  p_id uuid,
  p_updated_by uuid
) RETURNS void AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: Only admins can delete hero slides.';
  END IF;
  UPDATE public.hero_slides SET
    deleted_at = now(),
    is_active = false,
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.rpc_soft_delete_hero_slide(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_soft_delete_hero_slide(uuid, uuid) TO authenticated, service_role;

-- 9. RPC: Reorder Hero Slides (expects an ordered array of IDs)
-- The ID at array position N receives sort_order = N. Unknown IDs are ignored.
-- idx_hero_slides_active_sort is a non-deferrable unique index, so writing the
-- final values directly can collide mid-swap. Listed rows are therefore first
-- moved to distinct temporary values below every existing sort_order, then
-- set to their final positions; both steps run in the caller's transaction.
CREATE OR REPLACE FUNCTION public.rpc_reorder_hero_slides(
  p_order uuid[]
) RETURNS void AS $$
DECLARE
  temp_base int;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied: Only admins can reorder hero slides.';
  END IF;
  IF p_order IS NULL OR cardinality(p_order) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_order) <> (SELECT count(DISTINCT u) FROM unnest(p_order) AS u) THEN
    RAISE EXCEPTION 'Invalid reorder: slide IDs must be unique and non-null.';
  END IF;

  SELECT LEAST(COALESCE(min(sort_order), 0), 0) - 1 INTO temp_base
  FROM public.hero_slides;

  -- Phase 1: temporary values (temp_base - N), unique and unused.
  UPDATE public.hero_slides AS h
  SET sort_order = temp_base - o.ord::int
  FROM unnest(p_order) WITH ORDINALITY AS o(id, ord)
  WHERE h.id = o.id;

  -- Phase 2: final values 1..N in the requested order.
  UPDATE public.hero_slides AS h
  SET sort_order = o.ord::int, updated_at = now()
  FROM unnest(p_order) WITH ORDINALITY AS o(id, ord)
  WHERE h.id = o.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.rpc_reorder_hero_slides(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_reorder_hero_slides(uuid[]) TO authenticated, service_role;

-- 10. View: Published Hero Slides (public read‑only)
-- RLS and policies apply to tables, not views. This view intentionally runs
-- with the owner's privileges (security_invoker = false) so anon can read the
-- filtered, column-limited published rows without any public policy on
-- public.hero_slides. security_barrier stops caller-supplied filters from being
-- evaluated before the published-only WHERE clause.
CREATE OR REPLACE VIEW public.published_hero_slides
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  id,
  name,
  desktop_image,
  mobile_image,
  heading,
  description,
  cta_label,
  cta_url,
  alt_text,
  sort_order
FROM public.hero_slides
WHERE is_active = true
  AND deleted_at IS NULL
ORDER BY sort_order;

-- Read-only access. The view is auto-updatable and runs as its owner, so every
-- write privilege (including Supabase's default grants to anon) must be revoked.
REVOKE ALL ON public.published_hero_slides FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.published_hero_slides TO anon, authenticated, service_role;

-- Defence in depth: anon reads only via the view above and never touches the table.
REVOKE ALL ON public.hero_slides FROM anon;

-- 11. Storage folder note: Hero images are expected under the "hero/" prefix in the existing website-media bucket.
-- No additional bucket policies are required because the existing admin upload policies already restrict actions to admins via public.is_admin().

-- End of migration
