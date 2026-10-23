-- =============================================================
-- Automated regression test for the Hero Slider max-4-active trigger
-- (public.check_max_active_slides, see 20261015000001_fix_hero_slides_concurrency.sql)
-- -------------------------------------------------------------
-- Run ONLY against a fresh, disposable database that has the migrations
-- applied (e.g. the local `supabase db start` container used in CI).
-- Never run it against production or a shared Supabase project.
--
--   psql -X -v ON_ERROR_STOP=1 -v disposable_db=true \
--        -f supabase/migrations/tests/hero_slides_concurrency_test.sql
--
-- Everything runs in one transaction and is rolled back at the end.
-- The test refuses to run unless `disposable_db` is set explicitly and
-- public.hero_slides is empty.
--
-- This script is single-session only. The genuine two-session concurrency
-- check lives in hero_slides_concurrency_run.sql (manual) and in
-- .github/workflows/hero-slider-concurrency.yml (automated).
-- -------------------------------------------------------------

\set ON_ERROR_STOP on

\if :{?disposable_db}
\else
  \echo 'Refusing to run: pass -v disposable_db=true and use a disposable test database only.'
  DO $$ BEGIN RAISE EXCEPTION 'disposable_db not set; refusing to run hero slider regression test'; END $$;
\endif

BEGIN;

-- -------------------------------------------------------------
-- 0. Guard: the table must be empty before anything else happens
-- -------------------------------------------------------------
DO $$
DECLARE
    cnt int;
BEGIN
    SELECT count(*) INTO cnt FROM public.hero_slides;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'public.hero_slides contains % rows; this test requires an empty, disposable database', cnt;
    END IF;
END $$;

-- -------------------------------------------------------------
-- Helper (temporary, rolled back with the transaction)
-- -------------------------------------------------------------
CREATE FUNCTION pg_temp.test_insert_slide(p_name text, p_is_active boolean)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    new_id uuid;
BEGIN
    INSERT INTO public.hero_slides (name, desktop_image, sort_order, is_active)
    VALUES (
        p_name,
        'https://example.com/' || md5(p_name) || '.jpg',
        (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.hero_slides),
        p_is_active
    )
    RETURNING id INTO new_id;
    RETURN new_id;
END;
$$;

-- -------------------------------------------------------------
-- 1. Insert four active, non-deleted slides; count must be exactly 4
-- -------------------------------------------------------------
SELECT pg_temp.test_insert_slide('Slide 1', true);
SELECT pg_temp.test_insert_slide('Slide 2', true);
SELECT pg_temp.test_insert_slide('Slide 3', true);
SELECT pg_temp.test_insert_slide('Slide 4', true);

DO $$
DECLARE
    cnt int;
BEGIN
    SELECT count(*) INTO cnt FROM public.hero_slides WHERE is_active AND deleted_at IS NULL;
    IF cnt <> 4 THEN
        RAISE EXCEPTION 'Expected 4 active slides after initial inserts, found %', cnt;
    END IF;
    RAISE NOTICE 'PASS: 4 active slides inserted';
END $$;

-- -------------------------------------------------------------
-- 2. A fifth active INSERT must fail with P0001 + exact message
-- -------------------------------------------------------------
DO $$
BEGIN
    BEGIN
        PERFORM pg_temp.test_insert_slide('Slide 5 (must fail)', true);
    EXCEPTION WHEN others THEN
        IF SQLSTATE = 'P0001' AND SQLERRM = 'Maximum of 4 active hero slides exceeded.' THEN
            RAISE NOTICE 'PASS: fifth active insert rejected (%: %)', SQLSTATE, SQLERRM;
            RETURN;
        END IF;
        RAISE EXCEPTION 'Fifth active insert failed with unexpected error %: %', SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Fifth active insert unexpectedly succeeded';
END $$;

-- -------------------------------------------------------------
-- 3. Activating an additional draft must fail with P0001 + exact message
-- -------------------------------------------------------------
SELECT pg_temp.test_insert_slide('Draft A', false);

DO $$
DECLARE
    draft_id uuid;
BEGIN
    SELECT id INTO STRICT draft_id FROM public.hero_slides WHERE name = 'Draft A';
    BEGIN
        UPDATE public.hero_slides SET is_active = true WHERE id = draft_id;
    EXCEPTION WHEN others THEN
        IF SQLSTATE = 'P0001' AND SQLERRM = 'Maximum of 4 active hero slides exceeded.' THEN
            RAISE NOTICE 'PASS: draft activation rejected (%: %)', SQLSTATE, SQLERRM;
            RETURN;
        END IF;
        RAISE EXCEPTION 'Draft activation failed with unexpected error %: %', SQLSTATE, SQLERRM;
    END;
    RAISE EXCEPTION 'Activating a fifth slide unexpectedly succeeded';
END $$;

-- -------------------------------------------------------------
-- 4. A normal edit of an active slide (4 active exist) must succeed
-- -------------------------------------------------------------
DO $$
DECLARE
    target_id uuid;
    n int;
BEGIN
    SELECT id INTO STRICT target_id FROM public.hero_slides WHERE name = 'Slide 1';
    UPDATE public.hero_slides SET heading = 'Slide 1 (edited)' WHERE id = target_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'Edit affected % rows, expected 1', n;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.hero_slides
                   WHERE id = target_id AND heading = 'Slide 1 (edited)' AND is_active) THEN
        RAISE EXCEPTION 'Edit did not persist the expected heading';
    END IF;
    RAISE NOTICE 'PASS: normal edit of an active slide succeeded';
END $$;

-- -------------------------------------------------------------
-- 5. Soft-delete frees a slot; the rejected draft can then be activated
-- -------------------------------------------------------------
DO $$
DECLARE
    target_id uuid;
    n int;
    cnt int;
BEGIN
    SELECT id INTO STRICT target_id FROM public.hero_slides WHERE name = 'Slide 4';
    UPDATE public.hero_slides SET deleted_at = now(), is_active = false WHERE id = target_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'Soft-delete affected % rows, expected 1', n;
    END IF;
    SELECT count(*) INTO cnt FROM public.hero_slides WHERE is_active AND deleted_at IS NULL;
    IF cnt <> 3 THEN
        RAISE EXCEPTION 'Expected 3 active slides after soft-delete, found %', cnt;
    END IF;
    RAISE NOTICE 'PASS: soft-delete freed a slot';
END $$;

DO $$
DECLARE
    draft_id uuid;
    n int;
BEGIN
    SELECT id INTO STRICT draft_id FROM public.hero_slides WHERE name = 'Draft A';
    UPDATE public.hero_slides SET is_active = true WHERE id = draft_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN
        RAISE EXCEPTION 'Reactivation affected % rows, expected 1', n;
    END IF;
    RAISE NOTICE 'PASS: draft activated after soft-delete';
END $$;

-- -------------------------------------------------------------
-- 6. Final active, non-deleted count must be exactly 4
-- -------------------------------------------------------------
DO $$
DECLARE
    cnt int;
BEGIN
    SELECT count(*) INTO cnt FROM public.hero_slides WHERE is_active AND deleted_at IS NULL;
    IF cnt <> 4 THEN
        RAISE EXCEPTION 'Final active slide count is % (expected 4)', cnt;
    END IF;
    RAISE NOTICE 'PASS: final active slide count is 4';
END $$;

-- Discard all test data and the temporary helper.
ROLLBACK;

\echo 'hero_slides regression test: ALL CHECKS PASSED (rolled back)'
