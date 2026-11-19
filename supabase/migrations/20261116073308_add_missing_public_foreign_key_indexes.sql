
-- THE TRAINERS
-- Add missing foreign-key indexes in public schema
-- Applied to Supabase: 20261116073308

BEGIN;

DO $$
DECLARE
  r record;
  v_idx text;
BEGIN
  FOR r IN
    SELECT
      c.conrelid,
      c.conname,
      string_agg(
        format('%I', a.attname),
        ', ' ORDER BY u.ord
      ) AS cols_sql,
      string_agg(
        a.attname,
        '_' ORDER BY u.ord
      ) AS cols_name,
      c.conrelid::regclass AS relname

    FROM pg_constraint c

    CROSS JOIN LATERAL
      unnest(c.conkey)
      WITH ORDINALITY u(attnum, ord)

    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = u.attnum

    JOIN pg_class cl
      ON cl.oid = c.conrelid

    JOIN pg_namespace ns
      ON ns.oid = cl.relnamespace

    WHERE c.contype = 'f'
      AND ns.nspname = 'public'

      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indisvalid
          AND i.indisready
          AND c.conkey <@
            (i.indkey::smallint[])
            [0:cardinality(c.conkey)-1]
      )

    GROUP BY c.conrelid, c.conname

  LOOP
    v_idx := left(
      'idx_'
      || replace(r.relname::text, '.', '_')
      || '_'
      || r.cols_name
      || '_fk',
      63
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %s (%s)',
      v_idx,
      r.relname,
      r.cols_sql
    );
  END LOOP;
END $$;

COMMIT;
