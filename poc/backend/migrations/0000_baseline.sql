-- M0-06 baseline.
-- Custom migration: it only establishes the application namespace and proves the
-- pinned migrator applies, records and never re-applies a file. M0 deliberately
-- creates no business table; content/audit/outbox arrive with M1-02.
COMMENT ON SCHEMA public IS 'IndaPlay TV2 PoC backend application namespace';
