-- Indexes for the hot auth paths (additive; names match Prisma's @@index defaults in schema.prisma).

-- AuditService.countRecentFailures: action + actor_username, max(id) of the last success (per-username login lock).
-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_actor_username_action_id_idx" ON "audit_logs"("actor_username", "action", "id");

-- TokenPhoneLimiter: count by action + target_type + target_id.
-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_target_type_target_id_action_idx" ON "audit_logs"("target_type", "target_id", "action");

-- AuditService.countRecentUserFailures: action + actor_user_id, max(id) of the last reset action.
-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_actor_user_id_action_id_idx" ON "audit_logs"("actor_user_id", "action", "id");

-- SessionService.destroyAllForUser / destroyOthersForUser / expired-session sweep.
-- CreateIndex
CREATE INDEX IF NOT EXISTS "sessions_user_id_idx" ON "sessions"("user_id");

-- AuthTokenService.issue: invalidate a person's unused tokens of a purpose.
-- CreateIndex
CREATE INDEX IF NOT EXISTS "auth_tokens_person_id_purpose_used_at_idx" ON "auth_tokens"("person_id", "purpose", "used_at");
