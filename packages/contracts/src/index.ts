import { z } from "zod";

export const OriginSchema = z.string().url().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === value &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  },
  "Expected a canonical HTTP(S) origin without credentials, path, query, or fragment."
);

export const GrantScopeSchema = z.enum(["autofill_login"]);
export const GrantStatusSchema = z.enum(["approved", "pending_approval", "denied"]);

export const ApprovedGrantSchema = z.object({
  status: z.literal("approved"),
  grant_id: z.string().min(24),
  origin: OriginSchema,
  expires_at: z.string().datetime(),
  scopes: z.array(GrantScopeSchema).min(1)
}).strict();

export const GrantRequestSchema = z.object({
  account_id: z.string().min(1),
  origin: OriginSchema,
  scopes: z.array(GrantScopeSchema).min(1),
  task_id: z.string().min(1).max(200).optional(),
  requested_ttl_seconds: z.number().int().min(30).max(900).default(300)
}).strict();

export const ExecutionResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("login_succeeded"), execution_id: z.string() }),
  z.object({
    status: z.literal("mfa_required"),
    execution_id: z.string(),
    handoff_id: z.string()
  }),
  z.object({
    status: z.literal("user_action_required"),
    execution_id: z.string(),
    action_id: z.string()
  }),
  z.object({
    status: z.literal("login_failed"),
    execution_id: z.string(),
    reason_code: z.string()
  })
]);

export type ApprovedGrant = z.infer<typeof ApprovedGrantSchema>;
export type GrantRequest = z.infer<typeof GrantRequestSchema>;
export type GrantScope = z.infer<typeof GrantScopeSchema>;
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
