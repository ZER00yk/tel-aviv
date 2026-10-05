-- Per-key reconciliation/retry checks use this partial index rather than repeated school scans.
CREATE INDEX IF NOT EXISTS school_file_storage_key ON school_resources((data->>'key')) WHERE kind='file';
