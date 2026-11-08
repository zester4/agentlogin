CREATE TABLE "webhook_delivery_queue" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "delivery_id" text NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "claim_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_delivery_queue_tenant_delivery_unique" UNIQUE("tenant_id","delivery_id"),
  CONSTRAINT "webhook_delivery_queue_claim_count" CHECK (claim_count >= 0),
  CONSTRAINT "webhook_delivery_queue_tenant_delivery_fk"
    FOREIGN KEY ("tenant_id","delivery_id")
    REFERENCES "webhook_deliveries"("tenant_id","id")
);
--> statement-breakpoint
CREATE INDEX "webhook_delivery_queue_due"
  ON "webhook_delivery_queue" ("available_at","lease_expires_at","created_at");
--> statement-breakpoint
-- This table is a deliberately minimal cross-tenant work index: it contains
-- only opaque tenant/delivery identifiers and lease metadata, never payloads,
-- endpoint URLs, signing keys, or event data. Tenant-owned data remains FORCE
-- RLS protected and must be fetched only after setting app.tenant_id.
REVOKE ALL ON TABLE "webhook_delivery_queue" FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentlogin_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "webhook_delivery_queue" TO agentlogin_runtime;
  END IF;
END
$$;
