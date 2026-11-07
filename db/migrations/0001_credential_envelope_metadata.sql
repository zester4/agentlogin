ALTER TABLE "credentials" ADD COLUMN "credential_id" text;
--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "iv" "bytea";
--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "auth_tag" "bytea";
--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN "revoked_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_credential_id_unique" UNIQUE("tenant_id","credential_id");
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_iv_length" CHECK ("iv" IS NULL OR octet_length("iv") = 12);
--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_auth_tag_length" CHECK ("auth_tag" IS NULL OR octet_length("auth_tag") = 16);
