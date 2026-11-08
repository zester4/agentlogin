export type LoginExecutionRequest = {
  executionId: string;
  grantId: string;
  tenantId: string;
  userId: string;
  authenticatedAgentId: string;
  accountRef: string;
  expectedOrigin: string;
  scope: string;
  policyVersion: number;
  approvalRef: string | null;
  taskId: string | null;
  executionContextId: string;
  operation: string;
  credentialRef: string;
  deadline: Date;
};

export type LoginExecutionOutcome =
  | { status: "login_succeeded" }
  | { status: "mfa_required"; handoffRef: string }
  | { status: "user_action_required"; actionRef: string }
  | {
      status: "login_failed";
      reasonCode:
        | "invalid_credentials"
        | "site_unavailable"
        | "unsupported_flow"
        | "challenge_detected";
    };

export interface IsolatedBrowserProvider {
  executeLogin(request: LoginExecutionRequest): Promise<LoginExecutionOutcome>;
  terminate(executionId: string): Promise<void>;
  healthCheck(): Promise<{ available: boolean }>;
}

// These fields must be constructed from freshly authenticated server/database state,
// never copied from agent-supplied metadata. Provider implementations must fail closed.
// Providers must isolate profiles/storage/downloads, enforce origin+redirect policy,
// scrub outputs, deny unsafe network targets, and expose no CDP/profile/cookie/session data to agents.
