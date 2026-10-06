-- v46: Reduce Postgres log volume so the Free plan Log Ingestion quota (1 GB)
-- is not exhausted by routine noise.
--
-- Hosted Supabase blocks most logging GUCs (log_min_messages, log_connections,
-- log_statement, ...) even for the postgres role — attempts fail with
-- "42501: permission denied to set parameter". This script tries each setting
-- inside a guarded block: permitted ones are applied, blocked ones are
-- skipped with a NOTICE. The script as a whole never fails.

DO $$
DECLARE
  settings text[][] := ARRAY[
    ['log_min_messages',        'warning'],
    ['log_min_error_statement', 'error'],
    ['log_statement',           'none'],
    ['log_lock_waits',          'off'],
    ['log_temp_files',          '10MB'],
    ['log_connections',         'off'],
    ['log_disconnections',      'off']
  ];
  s text[];
BEGIN
  FOREACH s SLICE 1 IN ARRAY settings LOOP
    BEGIN
      EXECUTE format('ALTER DATABASE postgres SET %I = %L', s[1], s[2]);
      RAISE NOTICE '%: applied', s[1];
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '%: skipped (%)', s[1], SQLERRM;
    END;
  END LOOP;
END $$;

-- Check what is actually in effect afterwards:
-- SELECT name, setting FROM pg_settings
-- WHERE name IN ('log_min_messages','log_min_error_statement','log_statement',
--                'log_lock_waits','log_temp_files','log_connections','log_disconnections');
