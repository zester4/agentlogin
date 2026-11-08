ALTER TABLE public.webhook_delivery_queue ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.webhook_delivery_queue FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.webhook_delivery_queue
  AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint
REVOKE ALL ON TABLE public.webhook_delivery_queue FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE public.webhook_delivery_queue FROM agentlogin_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.webhook_delivery_queue TO agentlogin_runtime;
--> statement-breakpoint
DO $bootstrap$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentlogin_webhook_queue_executor') THEN
    RAISE EXCEPTION 'Missing pre-provisioned role agentlogin_webhook_queue_executor';
  END IF;
  IF NOT pg_has_role(current_user, 'agentlogin_webhook_queue_executor', 'MEMBER') THEN
    RAISE EXCEPTION 'Migration role must be a member of agentlogin_webhook_queue_executor';
  END IF;
END;
$bootstrap$;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA public TO agentlogin_webhook_queue_executor;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON TABLE public.webhook_delivery_queue TO agentlogin_webhook_queue_executor;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.claim_webhook_delivery_queue(p_limit integer DEFAULT 10)
RETURNS TABLE(tenant_id text, delivery_id text, lease_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Invalid webhook queue claim limit';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT q.tenant_id, q.delivery_id
      FROM public.webhook_delivery_queue AS q
     WHERE q.available_at <= pg_catalog.now()
       AND (q.lease_expires_at IS NULL OR q.lease_expires_at < pg_catalog.now())
     ORDER BY q.available_at, q.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT p_limit
  )
  UPDATE public.webhook_delivery_queue AS q
     SET lease_token = pg_catalog.gen_random_uuid()::text,
         lease_expires_at = pg_catalog.now() + interval '45 seconds',
         claim_count = q.claim_count + 1
    FROM due
   WHERE q.tenant_id = due.tenant_id
     AND q.delivery_id = due.delivery_id
  RETURNING q.tenant_id, q.delivery_id, q.lease_token;
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION public.claim_webhook_delivery_queue(integer) OWNER TO agentlogin_webhook_queue_executor;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_webhook_delivery_queue(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.claim_webhook_delivery_queue(integer) TO agentlogin_runtime;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.complete_webhook_delivery_queue(
  p_tenant_id text,
  p_delivery_id text,
  p_lease_token text,
  p_retry_at timestamptz,
  p_delete boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  affected integer;
BEGIN
  IF p_tenant_id IS NULL OR p_delivery_id IS NULL OR p_lease_token IS NULL OR p_delete IS NULL THEN
    RAISE EXCEPTION 'Invalid webhook queue completion arguments';
  END IF;
  IF NOT p_delete AND p_retry_at IS NULL THEN
    RAISE EXCEPTION 'Retry time is required when retaining a queue item';
  END IF;

  IF p_delete THEN
    DELETE FROM public.webhook_delivery_queue
     WHERE tenant_id = p_tenant_id
       AND delivery_id = p_delivery_id
       AND lease_token = p_lease_token;
  ELSE
    UPDATE public.webhook_delivery_queue
       SET available_at = p_retry_at,
           lease_token = NULL,
           lease_expires_at = NULL
     WHERE tenant_id = p_tenant_id
       AND delivery_id = p_delivery_id
       AND lease_token = p_lease_token;
  END IF;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION public.complete_webhook_delivery_queue(text, text, text, timestamptz, boolean) OWNER TO agentlogin_webhook_queue_executor;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.complete_webhook_delivery_queue(text, text, text, timestamptz, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.complete_webhook_delivery_queue(text, text, text, timestamptz, boolean) TO agentlogin_runtime;

--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM agentlogin_webhook_queue_executor;
