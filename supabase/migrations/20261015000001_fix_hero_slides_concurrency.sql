-- ======================================================================
-- Migration: 20261015000001_fix_hero_slides_concurrency.sql
-- Purpose:   Replace the original check_max_active_slides() trigger with
--            a concurrency‑safe implementation that uses a transaction‑
--            scoped advisory lock.
--
-- IMPORTANT:
--   • The original migration (20261010000006_hero_slides.sql) is left
--     untouched – this file can be applied on top of any database that
--     already ran it.
--   • The lock key is a **decimal bigint** (no hexadecimal syntax).
-- ======================================================================

-- 1️⃣ Drop the old trigger and its function (if they exist)
DROP TRIGGER IF EXISTS trg_check_max_active_slides ON public.hero_slides;
DROP FUNCTION IF EXISTS public.check_max_active_slides();

-- 2️⃣ Re‑create the safe function
CREATE OR REPLACE FUNCTION public.check_max_active_slides()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    active_cnt   int;
    -- A 64‑bit integer that is unique to this lock.
    -- Decimal representation of a chosen lock key within signed BIGINT range.
    lock_key     bigint := 7640891576956012809;
BEGIN
    -----------------------------------------------------------------
    -- Acquire a *transaction‑scoped* advisory lock.
    -- All concurrent INSERT/UPDATE on hero_slides will block here,
    -- guaranteeing that the count check is performed atomically.
    -----------------------------------------------------------------
    PERFORM pg_advisory_xact_lock(lock_key);

    -----------------------------------------------------------------
    -- Count currently active (non‑deleted) rows **excluding** the row
    -- we are about to change (NEW.id).  This works for both INSERT
    -- (where NEW.id does not yet exist) and UPDATE (where we may be
    -- toggling is_active or restoring a soft‑deleted row).
    -----------------------------------------------------------------
    SELECT count(*) INTO active_cnt
    FROM public.hero_slides
    WHERE is_active = true
      AND deleted_at IS NULL
      AND id <> NEW.id;          -- exclude the row being inserted/updated

    -- If the *new* version of the row will be active, add it to the count.
    IF NEW.is_active AND NEW.deleted_at IS NULL THEN
        active_cnt := active_cnt + 1;
    END IF;

    -- Enforce the hard limit of four active slides.
    IF active_cnt > 4 THEN
        RAISE EXCEPTION 'Maximum of 4 active hero slides exceeded.';
    END IF;

    RETURN NEW;
END;
$$;

-- 3️⃣ Re‑attach the trigger (same name as before)
CREATE TRIGGER trg_check_max_active_slides
BEFORE INSERT OR UPDATE ON public.hero_slides
FOR EACH ROW
EXECUTE FUNCTION public.check_max_active_slides();
