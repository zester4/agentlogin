import { sql } from "drizzle-orm";
import {
  check, customType, foreignKey, index, integer, jsonb, pgPolicy, pgTable, text,
  timestamp, unique, type AnyPgColumn,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const tenantPolicy = (tenantId: AnyPgColumn) =>
  pgPolicy("tenant_isolation", {
    as: "permissive", for: "all", to: "public",
    using: sql`${tenantId} = current_setting('app.tenant_id', true)`,
    withCheck: sql`${tenantId} = current_setting('app.tenant_id', true)`,
  });

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(), name: text("name").notNull(),
  status: text("status").notNull().default("active"), createdAt: createdAt(),
}, (t) => [pgPolicy("tenant_isolation", {
  as: "permissive", for: "all", to: "public",
  using: sql`${t.id} = current_setting('app.tenant_id', true)`,
  withCheck: sql`${t.id} = current_setting('app.tenant_id', true)`,
})]).enableRLS();

export const users = pgTable("users", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  authSubject: text("auth_subject").notNull(), status: text("status").notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [
  unique("users_tenant_auth_subject_unique").on(t.tenantId, t.authSubject),
  unique("users_tenant_id_unique").on(t.tenantId, t.id), tenantPolicy(t.tenantId),
]).enableRLS();

export const developers = pgTable("developers", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(), status: text("status").notNull().default("active"), createdAt: createdAt(),
}, (t) => [unique("developers_tenant_id_unique").on(t.tenantId, t.id), tenantPolicy(t.tenantId)]).enableRLS();

export const developerMemberships = pgTable("developer_memberships", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(), developerId: text("developer_id").notNull(),
  role: text("role").notNull(), status: text("status").notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [
  unique("developer_memberships_tenant_user_developer_unique").on(t.tenantId, t.userId, t.developerId),
  foreignKey({ name: "developer_memberships_tenant_user_fk", columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ name: "developer_memberships_tenant_developer_fk", columns: [t.tenantId, t.developerId], foreignColumns: [developers.tenantId, developers.id] }),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const agents = pgTable("agents", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  developerId: text("developer_id").notNull(), name: text("name").notNull(),
  identityType: text("identity_type").notNull(), status: text("status").notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [
  unique("agents_tenant_id_unique").on(t.tenantId, t.id),
  unique("agents_tenant_developer_id_unique").on(t.tenantId, t.developerId, t.id),
  foreignKey({ name: "agents_tenant_developer_fk", columns: [t.tenantId, t.developerId], foreignColumns: [developers.tenantId, developers.id] }),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const connectedAccounts = pgTable("connected_accounts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  userId: text("user_id").notNull(), provider: text("provider").notNull(), origin: text("origin").notNull(),
  displayLabel: text("display_label").notNull(), status: text("status").notNull().default("active"),
  createdAt: createdAt(),
}, (t) => [
  unique("connected_accounts_tenant_id_unique").on(t.tenantId, t.id),
  foreignKey({ name: "connected_accounts_tenant_user_fk", columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const credentials = pgTable("credentials", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  accountId: text("account_id").notNull(), credentialId: text("credential_id"),
  credentialType: text("credential_type").notNull(),
  ciphertext: bytea("ciphertext").notNull(), iv: bytea("iv"), authTag: bytea("auth_tag"),
  wrappedDek: bytea("wrapped_dek").notNull(), keyVersion: text("key_version").notNull(),
  recordVersion: integer("record_version").notNull().default(1),
  status: text("status").notNull().default("active"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [
  unique("credentials_tenant_id_unique").on(t.tenantId, t.id),
  unique("credentials_tenant_credential_id_unique").on(t.tenantId, t.credentialId),
  check("credentials_iv_length", sql.raw("iv IS NULL OR octet_length(iv) = 12")),
  check("credentials_auth_tag_length", sql.raw("auth_tag IS NULL OR octet_length(auth_tag) = 16")),
  foreignKey({ name: "credentials_tenant_account_fk", columns: [t.tenantId, t.accountId], foreignColumns: [connectedAccounts.tenantId, connectedAccounts.id] }),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const delegations = pgTable("delegations", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  userId: text("user_id").notNull(), agentId: text("agent_id").notNull(), accountId: text("account_id").notNull(),
  scopes: text("scopes").array().notNull(), status: text("status").notNull().default("active"), createdAt: createdAt(),
}, (t) => [
  unique("delegations_tenant_user_agent_account_unique").on(t.tenantId, t.userId, t.agentId, t.accountId),
  foreignKey({ name: "delegations_tenant_user_fk", columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ name: "delegations_tenant_agent_fk", columns: [t.tenantId, t.agentId], foreignColumns: [agents.tenantId, agents.id] }),
  foreignKey({ name: "delegations_tenant_account_fk", columns: [t.tenantId, t.accountId], foreignColumns: [connectedAccounts.tenantId, connectedAccounts.id] }),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const grants = pgTable("grants", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  userId: text("user_id").notNull(), agentId: text("agent_id").notNull(), accountId: text("account_id").notNull(),
  origin: text("origin").notNull(), scopes: text("scopes").array().notNull(), taskId: text("task_id"),
  policyVersion: integer("policy_version").notNull(), approvalId: text("approval_id"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [
  unique("grants_tenant_id_unique").on(t.tenantId, t.id),
  check("grants_expiry_after_issue", sql.raw("expires_at > issued_at")),
  foreignKey({ name: "grants_tenant_user_fk", columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }),
  foreignKey({ name: "grants_tenant_agent_fk", columns: [t.tenantId, t.agentId], foreignColumns: [agents.tenantId, agents.id] }),
  foreignKey({ name: "grants_tenant_account_fk", columns: [t.tenantId, t.accountId], foreignColumns: [connectedAccounts.tenantId, connectedAccounts.id] }),
  index("grants_active_lookup").on(t.tenantId, t.agentId, t.expiresAt).where(sql`${t.revokedAt} IS NULL`),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  grantId: text("grant_id").notNull(), requestedBy: text("requested_by").notNull(),
  decision: text("decision").notNull(), decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }), createdAt: createdAt(),
}, (t) => [
  foreignKey({ name: "approvals_tenant_grant_fk", columns: [t.tenantId, t.grantId], foreignColumns: [grants.tenantId, grants.id] }),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const executions = pgTable("executions", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  grantId: text("grant_id").notNull(), operation: text("operation").notNull(), status: text("status").notNull(),
  safeResultCode: text("safe_result_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ name: "executions_tenant_grant_fk", columns: [t.tenantId, t.grantId], foreignColumns: [grants.tenantId, grants.id] }),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  actorType: text("actor_type").notNull(), actorId: text("actor_id").notNull(),
  eventType: text("event_type").notNull(), resourceRef: text("resource_ref"),
  decision: text("decision"), correlationId: text("correlation_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}), createdAt: createdAt(),
}, (t) => [
  index("audit_events_tenant_time").on(t.tenantId, t.createdAt), tenantPolicy(t.tenantId),
]).enableRLS();

export const agentCredentials = pgTable("agent_credentials", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  developerId: text("developer_id").notNull(), agentId: text("agent_id").notNull(),
  tokenHash: bytea("token_hash").notNull().unique(), createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => [
  unique("agent_credentials_tenant_id_unique").on(t.tenantId, t.id),
  check("agent_credentials_token_hash_length", sql.raw("octet_length(token_hash) = 32")),
  check("agent_credentials_expiry_after_issue", sql.raw("expires_at > created_at")),
  foreignKey({ name: "agent_credentials_tenant_developer_fk", columns: [t.tenantId, t.developerId], foreignColumns: [developers.tenantId, developers.id] }),
  foreignKey({ name: "agent_credentials_tenant_agent_fk", columns: [t.tenantId, t.agentId], foreignColumns: [agents.tenantId, agents.id] }),
  foreignKey({ name: "agent_credentials_tenant_developer_agent_fk", columns: [t.tenantId, t.developerId, t.agentId], foreignColumns: [agents.tenantId, agents.developerId, agents.id] }),
  index("agent_credentials_active_lookup").on(t.id, t.expiresAt).where(sql`${t.revokedAt} IS NULL`),
  tenantPolicy(t.tenantId),
]).enableRLS();



// Tenant-scoped webhook persistence. Endpoint signing keys are stored only as
// encrypted envelopes; plaintext signing secrets must never be persisted.
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  developerId: text("developer_id").notNull(), url: text("url").notNull(),
  eventTypes: text("event_types").array().notNull(), status: text("status").notNull().default("active"),
  secretCiphertext: bytea("secret_ciphertext").notNull(), secretIv: bytea("secret_iv").notNull(),
  secretAuthTag: bytea("secret_auth_tag").notNull(), wrappedDek: bytea("wrapped_dek").notNull(),
  keyVersion: text("key_version").notNull(), secretVersion: integer("secret_version").notNull().default(1),
  createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
}, (t) => [
  unique("webhook_endpoints_tenant_id_unique").on(t.tenantId, t.id),
  check("webhook_endpoints_url_length", sql.raw("char_length(url) BETWEEN 8 AND 2048")),
  check("webhook_endpoints_event_types_nonempty", sql.raw("cardinality(event_types) > 0")),
  check("webhook_endpoints_status", sql.raw("status IN ('active', 'disabled')")),
  check("webhook_endpoints_secret_version_positive", sql.raw("secret_version > 0")),
  check("webhook_endpoints_secret_iv_length", sql.raw("octet_length(secret_iv) = 12")),
  check("webhook_endpoints_secret_auth_tag_length", sql.raw("octet_length(secret_auth_tag) = 16")),
  foreignKey({ name: "webhook_endpoints_tenant_developer_fk", columns: [t.tenantId, t.developerId], foreignColumns: [developers.tenantId, developers.id] }),
  index("webhook_endpoints_tenant_status").on(t.tenantId, t.status), tenantPolicy(t.tenantId),
]).enableRLS();

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  eventType: text("event_type").notNull(), resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(), payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(), createdAt: createdAt(),
}, (t) => [
  unique("webhook_events_tenant_id_unique").on(t.tenantId, t.id),
  check("webhook_events_payload_object", sql.raw("jsonb_typeof(payload) = 'object'")),
  index("webhook_events_tenant_created").on(t.tenantId, t.createdAt),
  index("webhook_events_tenant_resource").on(t.tenantId, t.resourceType, t.resourceId),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  endpointId: text("endpoint_id").notNull(), eventId: text("event_id").notNull(),
  status: text("status").notNull().default("pending"), attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(8),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: text("lease_token"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }), deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
  createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("webhook_deliveries_tenant_id_unique").on(t.tenantId, t.id),
  unique("webhook_deliveries_tenant_endpoint_event_unique").on(t.tenantId, t.endpointId, t.eventId),
  check("webhook_deliveries_status", sql.raw("status IN ('pending', 'leased', 'delivered', 'dead_lettered', 'cancelled')")),
  check("webhook_deliveries_attempt_count", sql.raw("attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts")),
  foreignKey({ name: "webhook_deliveries_tenant_endpoint_fk", columns: [t.tenantId, t.endpointId], foreignColumns: [webhookEndpoints.tenantId, webhookEndpoints.id] }),
  foreignKey({ name: "webhook_deliveries_tenant_event_fk", columns: [t.tenantId, t.eventId], foreignColumns: [webhookEvents.tenantId, webhookEvents.id] }),
  index("webhook_deliveries_due").on(t.status, t.nextAttemptAt, t.createdAt),
  index("webhook_deliveries_tenant_endpoint_created").on(t.tenantId, t.endpointId, t.createdAt),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const webhookDeliveryAttempts = pgTable("webhook_delivery_attempts", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id),
  deliveryId: text("delivery_id").notNull(), attemptNumber: integer("attempt_number").notNull(),
  outcome: text("outcome").notNull(), httpStatus: integer("http_status"), latencyMs: integer("latency_ms"),
  responseSummary: text("response_summary"), errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  unique("webhook_delivery_attempts_tenant_id_unique").on(t.tenantId, t.id),
  unique("webhook_delivery_attempts_tenant_delivery_number_unique").on(t.tenantId, t.deliveryId, t.attemptNumber),
  check("webhook_delivery_attempts_number_positive", sql.raw("attempt_number > 0")),
  check("webhook_delivery_attempts_outcome", sql.raw("outcome IN ('succeeded', 'retryable_failure', 'permanent_failure', 'timeout')")),
  check("webhook_delivery_attempts_http_status", sql.raw("http_status IS NULL OR http_status BETWEEN 100 AND 599")),
  check("webhook_delivery_attempts_latency", sql.raw("latency_ms IS NULL OR latency_ms >= 0")),
  foreignKey({ name: "webhook_delivery_attempts_tenant_delivery_fk", columns: [t.tenantId, t.deliveryId], foreignColumns: [webhookDeliveries.tenantId, webhookDeliveries.id] }),
  index("webhook_delivery_attempts_tenant_delivery").on(t.tenantId, t.deliveryId, t.attemptNumber),
  tenantPolicy(t.tenantId),
]).enableRLS();

export const schema = {
  tenants, users, developers, developerMemberships, agents, connectedAccounts, credentials, delegations,
  grants, approvals, executions, auditEvents, agentCredentials,\n  webhookEndpoints, webhookEvents, webhookDeliveries, webhookDeliveryAttempts,
};
