-- =============================================================
-- Automated regression test for the homepage hero banner
-- (public.validate_home_hero_banner and the hero-uploads bucket,
--  see 20261023000001_home_hero_banner.sql)
-- -------------------------------------------------------------
-- Run ONLY against a fresh, disposable database that has the migrations
-- applied (e.g. the local `supabase db start` container used in CI).
-- Never run it against production or a shared Supabase project.
--
--   psql -X -v ON_ERROR_STOP=1 -v disposable_db=true \
--        -f supabase/migrations/tests/home_hero_banner_test.sql
--
-- Everything runs in one transaction and is rolled back at the end.
-- -------------------------------------------------------------

\set ON_ERROR_STOP on

\if :{?disposable_db}
\else
  \echo 'Refusing to run: pass -v disposable_db=true and use a disposable test database only.'
  DO $$ BEGIN RAISE EXCEPTION 'disposable_db not set; refusing to run hero banner regression test'; END $$;
\endif

BEGIN;

-- -------------------------------------------------------------
-- Helpers (temporary, rolled back with the transaction)
-- -------------------------------------------------------------
CREATE FUNCTION pg_temp.img(n int, with_mobile boolean DEFAULT false)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT jsonb_build_object(
    'id', 'img-' || n,
    'desktop_image', 'https://test.supabase.co/storage/v1/object/public/website-media/hero/d' || n || '.webp',
    'mobile_image', CASE WHEN with_mobile
      THEN to_jsonb('https://test.supabase.co/storage/v1/object/public/website-media/hero/m' || n || '.webp')
      ELSE 'null'::jsonb END,
    'alt', 'Banner ' || n
  );
$$;

-- Writes hero.banner_enabled / hero.banner_images into the home draft, keeping the shared text.
CREATE FUNCTION pg_temp.set_banner(enabled jsonb, images jsonb)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.page_content
  SET content = jsonb_set(
    content,
    '{hero}',
    (content -> 'hero') || jsonb_build_object('banner_enabled', enabled, 'banner_images', images)
  )
  WHERE page_slug = 'home' AND version = 'draft';
$$;

CREATE FUNCTION pg_temp.expect_error(stmt text, expected text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    IF SQLSTATE = 'P0001' AND position(expected IN SQLERRM) > 0 THEN
      RAISE NOTICE 'PASS: rejected "%"', SQLERRM;
      RETURN;
    END IF;
    RAISE EXCEPTION 'Unexpected error for [%]: % %', stmt, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'Statement unexpectedly succeeded: %', stmt;
END;
$$;

-- -------------------------------------------------------------
-- 0. Guard: seeded home draft + published rows must exist
-- -------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public.page_content WHERE page_slug = 'home') <> 2 THEN
    RAISE EXCEPTION 'Expected seeded home draft and published rows';
  END IF;
END $$;

-- -------------------------------------------------------------
-- 1. Existing content without banner keys is untouched and still writable
-- -------------------------------------------------------------
UPDATE public.page_content SET updated_at = now() WHERE page_slug = 'home';
DO $$ BEGIN RAISE NOTICE 'PASS: legacy home content (no banner keys) still writable'; END $$;

-- -------------------------------------------------------------
-- 2. Valid configurations: 1, 2, 3 and 4 images, with and without mobile
-- -------------------------------------------------------------
SELECT pg_temp.set_banner('true', jsonb_build_array(pg_temp.img(1)));
SELECT pg_temp.set_banner('true', jsonb_build_array(pg_temp.img(1), pg_temp.img(2, true)));
SELECT pg_temp.set_banner('true', jsonb_build_array(pg_temp.img(1), pg_temp.img(2), pg_temp.img(3)));
SELECT pg_temp.set_banner('true', jsonb_build_array(pg_temp.img(1, true), pg_temp.img(2), pg_temp.img(3), pg_temp.img(4, true)));
SELECT pg_temp.set_banner('false', '[]'::jsonb);
DO $$ BEGIN RAISE NOTICE 'PASS: 1-4 images accepted; banner off with no images accepted'; END $$;

-- -------------------------------------------------------------
-- 3. Invalid configurations are rejected
-- -------------------------------------------------------------
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('true', '[]'::jsonb)$q$,
  'needs at least one image');
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('true', jsonb_build_array(pg_temp.img(1), pg_temp.img(2), pg_temp.img(3), pg_temp.img(4), pg_temp.img(5)))$q$,
  'at most 4 images');
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('"yes"', jsonb_build_array(pg_temp.img(1)))$q$,
  'must be true or false');
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('true', '{"a": 1}'::jsonb)$q$,
  'must be a list');
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('true', '[{"desktop_image": "https://evil.example.com/x.webp"}]'::jsonb)$q$,
  'needs a desktop image');
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('true', '[{"mobile_image": null}]'::jsonb)$q$,
  'needs a desktop image');
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('true', '[{"desktop_image": "https://test.supabase.co/storage/v1/object/public/website-media/hero/d1.svg"}]'::jsonb)$q$,
  'needs a desktop image');
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('true', jsonb_build_array(pg_temp.img(1) || '{"mobile_image": "https://test.supabase.co/storage/v1/object/public/website-media/uploads/m.webp"}'))$q$,
  'mobile images must be uploaded');
SELECT pg_temp.expect_error(
  $q$SELECT pg_temp.set_banner('true', jsonb_build_array(pg_temp.img(1) || jsonb_build_object('alt', repeat('a', 251))))$q$,
  '250 characters');
SELECT pg_temp.expect_error(
  $q$UPDATE public.page_content SET content = jsonb_set(content, '{hero,cta_primary,to}', '"javascript:alert(1)"') WHERE page_slug = 'home' AND version = 'draft'$q$,
  'Button links must start');

-- Non-home pages are not affected by the banner rules
UPDATE public.page_content
SET content = jsonb_set(content, '{hero,banner_images}', '"anything"')
WHERE page_slug = 'about' AND version = 'draft';
DO $$ BEGIN RAISE NOTICE 'PASS: non-home pages unaffected'; END $$;

-- -------------------------------------------------------------
-- 4. publish_page copies a valid banner draft; the published row is validated too
-- -------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000a001', 'hero-test-admin@example.com');
INSERT INTO public.admin_users (id, email) VALUES ('00000000-0000-0000-0000-00000000a001', 'hero-test-admin@example.com');
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-00000000b002', 'hero-test-user@example.com');

SELECT pg_temp.set_banner('true', jsonb_build_array(pg_temp.img(1), pg_temp.img(2)));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
SELECT public.publish_page('home');
RESET ROLE;

DO $$
DECLARE
  pub jsonb;
BEGIN
  SELECT content -> 'hero' INTO pub FROM public.page_content WHERE page_slug = 'home' AND version = 'published';
  IF jsonb_array_length(pub -> 'banner_images') <> 2 OR (pub ->> 'banner_enabled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Published banner mismatch: %', pub;
  END IF;
  IF pub ->> 'title' IS NULL OR pub ->> 'kicker' IS NULL THEN
    RAISE EXCEPTION 'Shared hero text lost on publish: %', pub;
  END IF;
  RAISE NOTICE 'PASS: publish_page published 2 banner images with shared text intact';
END $$;

SELECT pg_temp.expect_error(
  $q$UPDATE public.page_content SET content = jsonb_set(content, '{hero,banner_images}', '[]') WHERE page_slug = 'home' AND version = 'published'$q$,
  'needs at least one image');

-- -------------------------------------------------------------
-- 5. Non-admins cannot write page content or publish
-- -------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
DO $$
DECLARE
  n int;
BEGIN
  UPDATE public.page_content SET content = '{}'::jsonb WHERE page_slug = 'home';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Non-admin updated % page_content rows', n;
  END IF;
  BEGIN
    PERFORM public.publish_page('home');
    RAISE EXCEPTION 'Non-admin publish unexpectedly succeeded';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE 'Access denied%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: non-admin cannot edit or publish';
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.page_content WHERE version = 'draft') THEN
    RAISE EXCEPTION 'anon can read draft page content';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.page_content WHERE page_slug = 'home' AND version = 'published') THEN
    RAISE EXCEPTION 'anon cannot read published home content';
  END IF;
  RAISE NOTICE 'PASS: anon reads published content only';
END $$;
RESET ROLE;

-- -------------------------------------------------------------
-- 6. hero-uploads bucket is private with admin-only object policies
-- -------------------------------------------------------------
DO $$
DECLARE
  b record;
BEGIN
  SELECT * INTO STRICT b FROM storage.buckets WHERE id = 'hero-uploads';
  IF b.public THEN RAISE EXCEPTION 'hero-uploads bucket is public'; END IF;
  IF b.file_size_limit <> 5242880 THEN RAISE EXCEPTION 'unexpected size limit %', b.file_size_limit; END IF;
  IF b.allowed_mime_types @> ARRAY['image/svg+xml'] THEN RAISE EXCEPTION 'SVG allowed'; END IF;
  RAISE NOTICE 'PASS: hero-uploads is private, 5 MB, raster images only';
END $$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name) VALUES ('hero-uploads', 'tmp/anon.webp');
  RAISE EXCEPTION 'anon inserted into hero-uploads';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: anon cannot upload temp files';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000b002","role":"authenticated"}', true);
DO $$
BEGIN
  INSERT INTO storage.objects (bucket_id, name) VALUES ('hero-uploads', 'tmp/user.webp');
  RAISE EXCEPTION 'non-admin inserted into hero-uploads';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'PASS: non-admin cannot upload temp files';
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000a001","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name) VALUES ('hero-uploads', 'elsewhere/admin.webp');
    RAISE EXCEPTION 'admin inserted outside tmp/';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('hero-uploads', 'tmp/admin.webp');
  RAISE NOTICE 'PASS: admin can upload only into tmp/';
END $$;
RESET ROLE;

ROLLBACK;

\echo 'All hero banner regression checks passed (transaction rolled back).'
