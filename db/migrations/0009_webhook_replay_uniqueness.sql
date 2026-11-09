ALTER TABLE public.webhook_deliveries
  DROP CONSTRAINT IF EXISTS webhook_deliveries_tenant_endpoint_event_unique;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS webhook_deliveries_tenant_endpoint_event_created
  ON public.webhook_deliveries (tenant_id, endpoint_id, event_id, created_at DESC);
