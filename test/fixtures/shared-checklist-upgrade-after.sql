DO $$
BEGIN
 IF (SELECT count(*) FROM "TaskHumanState") <> (SELECT count(*) FROM old_state)
 OR (SELECT count(*) FROM "TaskChecklistItem") <> (SELECT count(*) FROM old_items)
 OR (SELECT count(*) FROM "TaskHumanAudit") <> (SELECT count(*) FROM old_audit)
 THEN RAISE EXCEPTION 'Legacy row counts changed'; END IF;
 IF EXISTS (SELECT 1 FROM "TaskHumanState" s JOIN old_state o ON true WHERE to_jsonb(s)-'archivedAt'-'deletedAt' <> o.value)
 OR EXISTS (SELECT 1 FROM "TaskChecklistItem" i JOIN old_items o USING(id) WHERE to_jsonb(i)-'sectionBoardId'-'parentId' <> o.value)
 OR EXISTS (SELECT 1 FROM "TaskHumanAudit" a JOIN old_audit o ON true WHERE to_jsonb(a) <> o.value)
 THEN RAISE EXCEPTION 'Legacy values changed'; END IF;
 IF EXISTS (SELECT 1 FROM "TaskChecklistItem" WHERE "parentId" IS NOT NULL OR "sectionBoardId" IS NOT NULL)
 OR EXISTS (SELECT 1 FROM "TaskHumanState" WHERE "archivedAt" IS NOT NULL OR "deletedAt" IS NOT NULL)
 THEN RAISE EXCEPTION 'Historical hierarchy/lifecycle inferred'; END IF;
END $$;
SELECT 'PASS: old IDs/order/assignment/deadline/completion/state/audit preserved; new fields null' AS upgrade_evidence;
