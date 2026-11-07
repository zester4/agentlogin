export type LoginExecutionRequest = {
  executionId: string; tenantId: string; userId: string; agentId: string;
  grantId: string; accountRef: string; expectedOrigin: string;
  credentialLease: { leaseId: string; token: string; expiresAt: Date };
  credentialId: string; recordVersion: number; taskId?: string; deadline: Date;
};
export type LoginExecutionOutcome =
  | {status:"login_succeeded"}
  | {status:"mfa_required";handoffRef:string}
  | {status:"user_action_required";actionRef:string}
  | {status:"login_failed";reasonCode:"invalid_credentials"|"site_unavailable"|"unsupported_flow"|"challenge_detected"};
export interface IsolatedBrowserProvider {
  executeLogin(request:LoginExecutionRequest):Promise<LoginExecutionOutcome>;
  terminate(executionId:string):Promise<void>;
  healthCheck():Promise<{available:boolean}>;
}
// credentialLease is a one-time, execution-scoped capability for the internal credential broker;
// never resolve a raw credentialRef or expose the lease token to the agent.
// Provider must isolate profiles/storage/downloads, enforce origin+redirect policy before autofill,
// scrub outputs, deny unsafe network targets, and expose no CDP/profile/cookie/session data to agents.
export * from "./coordinator.js";
