-- Integrity controls that Prisma's schema language cannot express.

-- 1. Audit events are append-only. UPDATE and DELETE are rejected at the
--    database level. Retention/archival must be performed by a DBA using a
--    documented procedure that temporarily disables this trigger (see docs/SECURITY.md).
CREATE OR REPLACE FUNCTION audit_event_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent records are append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_block_mutation();

-- Status history tables are append-only too.
CREATE TRIGGER request_history_no_update
  BEFORE UPDATE ON "RequestStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION audit_event_block_mutation();
CREATE TRIGGER project_history_no_update
  BEFORE UPDATE ON "ProjectStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION audit_event_block_mutation();

-- 2. Value-range checks.
ALTER TABLE "Feedback" ADD CONSTRAINT feedback_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "ProjectRisk" ADD CONSTRAINT risk_likelihood_range CHECK (likelihood BETWEEN 1 AND 5);
ALTER TABLE "ProjectRisk" ADD CONSTRAINT risk_impact_range CHECK (impact BETWEEN 1 AND 5);
ALTER TABLE "Project" ADD CONSTRAINT project_progress_range CHECK ("progressPercent" BETWEEN 0 AND 100);
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT milestone_weight_positive CHECK (weight > 0);
ALTER TABLE "ProjectTask" ADD CONSTRAINT task_weight_positive CHECK (weight > 0);
ALTER TABLE "ProjectWorkLog" ADD CONSTRAINT worklog_hours_range CHECK (hours > 0 AND hours <= 24);
ALTER TABLE "TaskDependency" ADD CONSTRAINT task_dependency_not_self CHECK ("taskId" <> "dependsOnId");
ALTER TABLE "Attachment" ADD CONSTRAINT attachment_size_positive CHECK ("sizeBytes" > 0);

-- 3. Full-text search indexes (knowledge repository and global search).
CREATE INDEX knowledge_fts_idx ON "KnowledgeDocument"
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(body,'')));
CREATE INDEX request_title_fts_idx ON "ServiceRequest"
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce("problemStatement",'')));
CREATE INDEX project_title_fts_idx ON "Project"
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));
