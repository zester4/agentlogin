-- Opaque agent tokens: persist only a SHA-256 hash of 256-bit random secret material.
CREATE TABLE agent_credentials (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  developer_id text NOT NULL,
  agent_id text NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, developer_id) REFERENCES developers (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_id) REFERENCES agents (tenant_id, id),
  CHECK (octet_length(token_hash) = 32),
  CHECK (expires_at > created_at)
);
CREATE INDEX agent_credentials_active_lookup
  ON agent_credentials (id, expires_at) WHERE revoked_at IS NULL;
