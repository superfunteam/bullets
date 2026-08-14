-- The watermark query reads max(seq) over ops older than 30 seconds on every
-- pull. Without this index that is a scan that grows with the log forever.
create index if not exists ops_created_at_idx on ops (created_at);
