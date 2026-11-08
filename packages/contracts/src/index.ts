import { z } from "zod";
export const OriginSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value.replace(/\/$/, "") && !url.username && !url.password;
  } catch { return false; }
}, "Expected a normalized HTTP(S) origin without credentials or path.");
export const GrantScopeSchema = z.enum(["autofill_login"]);
export const GrantStatusSchema = z.enum(["approved", "pending_approval", "denied"]);
export const ApprovedGrantSchema = z.object({
  status: z.literal("approved"), grant_id: z.string().min(24), origin: OriginSchema,
  expires_at: z.string().datetime(), scopes: z.array(GrantScopeSchema).min(1)
}).strict();
export const PendingGrantSchema = z.object({
  status: z.literal("pending_approval"),
  grant_id: z.string().min(1),
  approval_id: z.string().min(1),
  expires_at: z.string().datetime()
}).strict();
export const AgentPrincipalSchema = z.object({
  tenant_id: z.string().min(1),
  developer_id: z.string().min(1),
  agent_id: z.string().min(1),
  credential_id: z.string().min(1)
}).strict();
export const AgentIdentitySchema = z.object({
  authenticated: z.literal(true),
  principal: AgentPrincipalSchema
}).strict();
export const AgentGrantStatusSchema = z.object({
  status: z.enum(["pending_approval", "approved", "denied", "expired", "revoked"]),
  grant_id: z.string().min(1),
  origin: OriginSchema,
  scopes: z.array(GrantScopeSchema),
  expires_at: z.string().datetime(),
  approved_at: z.string().datetime().nullable()
}).strict();
export const GrantRequestSchema = z.object({
  account_id: z.string().min(1), origin: OriginSchema, scopes: z.array(GrantScopeSchema).min(1),
  task_id: z.string().min(1).max(200).optional(), requested_ttl_seconds: z.number().int().min(30).max(900).default(300)
}).strict();
export const ExecutionFailureCodeSchema = z.enum([
  "tenant_mismatch", "user_mismatch", "agent_mismatch", "account_mismatch",
  "origin_mismatch", "scope_denied", "policy_version_mismatch", "expired",
  "revoked", "not_approved", "account_unavailable", "invalid_execution_policy",
  "provider_unavailable", "audit_unavailable", "site_unavailable",
  "invalid_credentials", "unsupported_flow", "challenge_detected"
]);
export const ExecutionResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("login_succeeded"), execution_id: z.string().min(1) }).strict(),
  z.object({ status: z.literal("mfa_required"), execution_id: z.string().min(1), handoff_id: z.string().min(1) }).strict(),
  z.object({ status: z.literal("user_action_required"), execution_id: z.string().min(1), action_id: z.string().min(1) }).strict(),
  z.object({ status: z.literal("login_failed"), execution_id: z.string().min(1), reason_code: ExecutionFailureCodeSchema }).strict()
]);
export type ApprovedGrant = z.infer<typeof ApprovedGrantSchema>;
export type PendingGrant = z.infer<typeof PendingGrantSchema>;
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;
export type AgentGrantStatus = z.infer<typeof AgentGrantStatusSchema>;
export type AgentPrincipal = z.infer<typeof AgentPrincipalSchema>;
export type GrantRequest = z.input<typeof GrantRequestSchema>;
export type ParsedGrantRequest = z.output<typeof GrantRequestSchema>;
export type GrantScope = z.infer<typeof GrantScopeSchema>;
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
