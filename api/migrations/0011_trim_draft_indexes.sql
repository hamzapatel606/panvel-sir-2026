-- ============================================================
-- SIR Panvel API
-- Migration 0011: Trim Draft / Final Draft indexes
-- ============================================================
-- On the D1 free plan every index adds a written row per insert
-- (limit: 100,000 rows written per day). These four indexes are on
-- low-variety columns, so they barely speed up searches but roughly
-- double the cost of every Draft / Final Draft import.
--
-- Searches on these columns now require a Part (enforced in the API),
-- so they scan ~1,000 rows of one Part instead of the whole table.
--
-- Kept: idx_draft_part_serial (Part + Sr No browsing, Part filter),
--       idx_draft_epic_nocase (EPIC lookups), and the name search.
-- ASDD indexes are untouched: ASDD is fully imported, so they cost nothing more.

DROP INDEX IF EXISTS idx_draft_relation_nocase;
DROP INDEX IF EXISTS idx_draft_house_nocase;
DROP INDEX IF EXISTS idx_draft_age;
DROP INDEX IF EXISTS idx_draft_gender_nocase;
