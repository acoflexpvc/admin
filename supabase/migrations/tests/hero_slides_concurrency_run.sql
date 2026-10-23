-- =============================================================
-- MANUAL two-session concurrency test for the Hero Slider trigger
-- -------------------------------------------------------------
-- Use ONLY a fresh, disposable database with the migrations applied
-- (e.g. a local `supabase db start` / `supabase start` container).
-- Never run this against production or a shared Supabase project:
-- unlike the automated regression test, this setup COMMITS rows.
--
-- This file is independent of hero_slides_concurrency_test.sql. It uses
-- no helper functions, and nothing is shared between sessions through
-- psql variables: you copy the printed UUIDs by hand.
--
-- -------------------------------------------------------------
-- STEP 0 - Controller terminal: run this file
-- -------------------------------------------------------------
--   psql -X -v ON_ERROR_STOP=1 -v disposable_db=true \
--        -f supabase/migrations/tests/hero_slides_concurrency_run.sql
--
-- It refuses to run unless public.hero_slides is empty, then commits three
-- active baseline slides and two inactive drafts and prints all five UUIDs.
-- Write them down:
--   <base1> <base2> <base3>   (Concurrency Base 1..3, active)
--   <draft_a> <draft_b>       (Concurrency Draft A/B, inactive)
--
-- -------------------------------------------------------------
-- STEP 1 - Session A (second terminal): activate Draft A, hold the txn
-- -------------------------------------------------------------
-- Paste as one block. The UPDATE takes the trigger's advisory lock
-- (pg_advisory_xact_lock(7640891576956012809)) and pg_sleep keeps the
-- transaction open for 20 seconds before committing:
--
--   BEGIN;
--   UPDATE public.hero_slides SET is_active = true WHERE id = '<draft_a>';
--   SELECT pg_sleep(20);
--   COMMIT;
--
-- Expected: UPDATE 1, then (after ~20 s) COMMIT.
--
-- -------------------------------------------------------------
-- STEP 2 - Session B (third terminal): start WITHIN those 20 seconds
-- -------------------------------------------------------------
--   \set VERBOSITY verbose
--   BEGIN;
--   UPDATE public.hero_slides SET is_active = true WHERE id = '<draft_b>';
--
-- Expected: the UPDATE hangs (it is waiting on Session A's advisory lock).
-- Optional proof of overlap, from the controller terminal while B hangs:
--
--   SELECT a.pid, a.wait_event_type, l.granted
--   FROM pg_locks l JOIN pg_stat_activity a USING (pid)
--   WHERE l.locktype = 'advisory'
--     AND l.classid = (7640891576956012809 >> 32)
--     AND l.objid   = (7640891576956012809 & 4294967295)
--     AND l.objsubid = 1;
--   -- one row granted = t (Session A), one row granted = f (Session B)
--
-- When Session A commits, Session B's UPDATE returns:
--   ERROR:  P0001: Maximum of 4 active hero slides exceeded.
-- Confirm the SQLSTATE and message explicitly, then end B's transaction:
--
--   \echo :LAST_ERROR_SQLSTATE      -- must print P0001
--   \echo :LAST_ERROR_MESSAGE       -- must print Maximum of 4 active hero slides exceeded.
--   ROLLBACK;
--
-- -------------------------------------------------------------
-- STEP 3 - Controller terminal: verify the final state
-- -------------------------------------------------------------
--   SELECT count(*) FROM public.hero_slides WHERE is_active AND deleted_at IS NULL;
--   -- must be exactly 4
--   SELECT id, name, is_active FROM public.hero_slides
--   WHERE id IN ('<draft_a>', '<draft_b>');
--   -- Draft A is_active = t, Draft B is_active = f
--
-- -------------------------------------------------------------
-- STEP 4 - Controller terminal: clean up using the exact captured IDs
-- -------------------------------------------------------------
--   DELETE FROM public.hero_slides
--   WHERE id IN ('<base1>', '<base2>', '<base3>', '<draft_a>', '<draft_b>');
--   -- expected: DELETE 5
-- =============================================================

\set ON_ERROR_STOP on

\if :{?disposable_db}
\else
  \echo 'Refusing to run: pass -v disposable_db=true and use a disposable test database only.'
  DO $$ BEGIN RAISE EXCEPTION 'disposable_db not set; refusing to run hero slider concurrency setup'; END $$;
\endif

BEGIN;

DO $$
DECLARE
    cnt int;
BEGIN
    SELECT count(*) INTO cnt FROM public.hero_slides;
    IF cnt <> 0 THEN
        RAISE EXCEPTION 'public.hero_slides contains % rows; use a fresh, disposable database', cnt;
    END IF;
END $$;

INSERT INTO public.hero_slides (name, desktop_image, sort_order, is_active)
VALUES
    ('Concurrency Base 1',  'https://example.com/base1.jpg',   1, true),
    ('Concurrency Base 2',  'https://example.com/base2.jpg',   2, true),
    ('Concurrency Base 3',  'https://example.com/base3.jpg',   3, true),
    ('Concurrency Draft A', 'https://example.com/draft_a.jpg', 4, false),
    ('Concurrency Draft B', 'https://example.com/draft_b.jpg', 5, false)
RETURNING id, name, is_active;

DO $$
DECLARE
    act_cnt int;
    drf_cnt int;
BEGIN
    SELECT count(*) INTO act_cnt FROM public.hero_slides WHERE is_active AND deleted_at IS NULL;
    SELECT count(*) INTO drf_cnt FROM public.hero_slides WHERE NOT is_active AND deleted_at IS NULL;
    IF act_cnt <> 3 OR drf_cnt <> 2 THEN
        RAISE EXCEPTION 'Unexpected baseline: % active, % drafts (expected 3 and 2)', act_cnt, drf_cnt;
    END IF;
END $$;

COMMIT;

\echo 'Baseline committed: 3 active + 2 drafts. Copy the five UUIDs above, then follow STEP 1-4 in this file''s header.'
