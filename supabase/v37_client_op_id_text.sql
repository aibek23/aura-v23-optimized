-- =============================================================================
-- v37: Align idempotency-key columns with the sync engine.
--
-- v35 adds client_op_id as TEXT only when a column does not already exist.
-- Older databases may already have UUID columns, leaving v36's TEXT RPC
-- parameter incompatible with sales.client_op_id and preventing suffixed keys
-- such as "<operation-id>:cash" from being stored in cash_operations.
-- Existing UUID values are preserved in their canonical text representation.
-- =============================================================================

BEGIN;

DO $migration$
DECLARE
  target_table text;
  current_type text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'cash_operations',
    'sale_returns',
    'sales',
    'supplier_debt_operations'
  ]
  LOOP
    SELECT column_info.udt_name
      INTO current_type
      FROM information_schema.columns AS column_info
     WHERE column_info.table_schema = 'public'
       AND column_info.table_name = target_table
       AND column_info.column_name = 'client_op_id';

    IF current_type IS NULL THEN
      RAISE EXCEPTION 'Expected public.%.client_op_id to exist', target_table;
    ELSIF current_type = 'uuid' THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN client_op_id TYPE text USING client_op_id::text',
        target_table
      );
    ELSIF current_type <> 'text' THEN
      RAISE EXCEPTION 'Unexpected type for public.%.client_op_id: %',
        target_table, current_type;
    END IF;
  END LOOP;
END
$migration$;

COMMIT;