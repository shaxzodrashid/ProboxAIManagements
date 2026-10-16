-- Isolated test database only. Snapshot every preexisting application table.
CREATE TABLE "_ChatGroupUpgradeSnapshot" (name TEXT PRIMARY KEY, digest TEXT NOT NULL);
DO $$
DECLARE tab RECORD; fingerprint TEXT;
BEGIN
 FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  AND tablename NOT IN ('_prisma_migrations', '_ChatGroupUpgradeSnapshot') LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(row_json, '''' ORDER BY row_json), '''')) FROM (SELECT to_jsonb(t)::text row_json FROM %I t) rows', tab.tablename) INTO fingerprint;
  INSERT INTO "_ChatGroupUpgradeSnapshot" VALUES (tab.tablename, fingerprint);
 END LOOP;
END $$;
