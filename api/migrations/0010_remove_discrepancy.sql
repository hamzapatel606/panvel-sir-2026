-- ============================================================
-- SIR Panvel API
-- Migration 0010: Remove the Discrepancy list
-- ============================================================
-- Every database (asdd, draft, final) was created from the same
-- migrations, so each one carries empty discrepancy tables.
-- Drop them so all databases have only Draft + ASDD tables.
-- Children are dropped before parents because of foreign keys.

DROP TRIGGER IF EXISTS discrepancy_records_ai;
DROP TRIGGER IF EXISTS discrepancy_records_ad;
DROP TRIGGER IF EXISTS discrepancy_records_au;

DROP TABLE IF EXISTS discrepancy_records_fts;
DROP TABLE IF EXISTS discrepancy_record_reasons;
DROP TABLE IF EXISTS discrepancy_records;
DROP TABLE IF EXISTS discrepancy_reasons;
