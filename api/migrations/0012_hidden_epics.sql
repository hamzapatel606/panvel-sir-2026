-- Removal requests: EPICs hidden from every public search on this site.
-- Same table in all three databases (Draft, Final Draft, ASDD); the admin
-- Worker adds/removes an EPIC in all three at once.
CREATE TABLE IF NOT EXISTS hidden_epics (
	epic_no TEXT PRIMARY KEY COLLATE NOCASE,
	note TEXT,
	created_at TEXT NOT NULL
);
