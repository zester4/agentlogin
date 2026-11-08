-- Identity credentials are one-way verifiers. Raw API credentials are never persisted.
ALTER TABLE users
  ADD COLUMN auth_issuer text,
  ADD COLUMN role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member'));

CREATE UNIQUE INDEX users_tenant_issuer_subject
  ON users (tenant_id, auth_issuer, auth_subject)
  WHERE auth_issuer IS NOT NULL;

ALTER TABLE agents
  ADD CONSTRAINT agents_tenant_agent_developer_unique
  UNIQUE (tenant_id, id, developer_id);

CREATE TABLE developer_api_keys (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  developer_id text NOT NULL,
  secret_hash bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  scopes text[] NOT NULL
    CHECK (cardinality(scopes) > 0)
    CHECK (array_position(scopes, NULL) IS NULL)
    CHECK (scopes <@ ARRAY['developer:read', 'agents:manage', 'keys:manage']::text[]),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_to_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, developer_id, id),
  FOREIGN KEY (tenant_id, developer_id) REFERENCES developers (tenant_id, id),
  FOREIGN KEY (tenant_id, developer_id, rotated_to_id)
    REFERENCES developer_api_keys (tenant_id, developer_id, id),
  CHECK (expires_at > created_at),
  CHECK (rotated_to_id IS NULL OR rotated_to_id <> id)
);

CREATE INDEX developer_api_keys_active_lookup
  ON developer_api_keys (tenant_id, developer_id, id)
  WHERE revoked_at IS NULL;

CREATE TABLE agent_credentials (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  developer_id text NOT NULL,
  agent_id text NOT NULL,
  secret_hash bytea NOT NULL CHECK (octet_length(secret_hash) = 32),
  scopes text[] NOT NULL
    CHECK (cardinality(scopes) > 0)
    CHECK (array_position(scopes, NULL) IS NULL)
    CHECK (scopes <@ ARRAY['agent:read']::text[]),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_to_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, developer_id, agent_id, id),
  FOREIGN KEY (tenant_id, agent_id, developer_id)
    REFERENCES agents (tenant_id, id, developer_id),
  FOREIGN KEY (tenant_id, developer_id, agent_id, rotated_to_id)
    REFERENCES agent_credentials (tenant_id, developer_id, agent_id, id),
  CHECK (expires_at > created_at),
  CHECK (rotated_to_id IS NULL OR rotated_to_id <> id)
);

CREATE INDEX agent_credentials_active_lookup
  ON agent_credentials (tenant_id, developer_id, agent_id, id)
  WHERE revoked_at IS NULL;

-- Every tenant-owned table is protected by RLS. Application queries also include explicit
-- tenant and owner predicates; RLS is defense in depth, not a replacement for authorization.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users',
    'developers',
    'agents',
    'connected_accounts',
    'credentials',
    'delegations',
    'grants',
    'approvals',
    'executions',
    'audit_events',
    'developer_api_keys',
    'agent_credentials'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',
      table_name
    );
  END LOOP;
END $$;

COMMENT ON TABLE developer_api_keys IS
  'One-way hashes of scoped developer API keys. Authentication lookup is tenant-constrained by identifiers in the presented credential, then secret hash is verified before a principal is created.';
COMMENT ON TABLE agent_credentials IS
  'One-way hashes of scoped per-agent credentials. Composite ownership FK binds every credential to its tenant, developer, and agent.';
COMMENT ON COLUMN users.auth_issuer IS
  'Exact issuer of the externally verified OIDC identity token.';
