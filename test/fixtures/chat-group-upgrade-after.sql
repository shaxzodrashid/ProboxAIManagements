DO $$
DECLARE tab RECORD; fingerprint TEXT;
BEGIN
 FOR tab IN SELECT * FROM "_ChatGroupUpgradeSnapshot" LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(row_json, '''' ORDER BY row_json), '''')) FROM (SELECT to_jsonb(t)::text row_json FROM %I t) rows', tab.name) INTO fingerprint;
  IF fingerprint <> tab.digest THEN RAISE EXCEPTION 'Existing rows changed in %', tab.name; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM "ChatGroup") OR EXISTS (SELECT 1 FROM "ChatGroupCreation") THEN
  RAISE EXCEPTION 'Metadata migration created unsolicited records';
 END IF;
END $$;
DROP TABLE "_ChatGroupUpgradeSnapshot";
