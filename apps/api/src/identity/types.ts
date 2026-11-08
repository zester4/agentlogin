export type DeveloperCredentialRecord = {
  id: string;
  tenantId: string;
  developerId: string;
  secretHash: Uint8Array;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  developerStatus: string;
  tenantStatus: string;
};

export type AgentCredentialRecord = {
  id: string;
  tenantId: string;
  developerId: string;
  agentId: string;
  secretHash: Uint8Array;
  scopes: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  agentStatus: string;
  developerStatus: string;
  tenantStatus: string;
};

export type UserIdentityRecord = {
  id: string;
  tenantId: string;
  role: "owner" | "admin" | "member";
  status: string;
};

export type AgentRecord = {
  id: string;
  tenantId: string;
  developerId: string;
  name: string;
  identityType: string;
  status: string;
  createdAt: Date;
};

export type DeveloperCredentialWrite = {
  id: string;
  secretHash: Uint8Array;
  scopes: string[];
  expiresAt: Date;
};

export type AgentCredentialWrite = DeveloperCredentialWrite & {
  agentId: string;
};

export type BootstrapTenantInput = {
  tenantId: string;
  tenantName: string;
  userId: string;
  ownerIssuer: string;
  ownerSubject: string;
  developerId: string;
  developerName: string;
  credential: DeveloperCredentialWrite;
};

export type CreateDeveloperInput = {
  tenantId: string;
  userId: string;
  developerId: string;
  developerName: string;
  credential: DeveloperCredentialWrite;
};

export type CreateAgentInput = {
  tenantId: string;
  developerId: string;
  agentId: string;
  name: string;
};

export interface IdentityStore {
  healthCheck(): Promise<boolean>;
  bootstrapTenant(input: BootstrapTenantInput): Promise<void>;
  findDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }): Promise<DeveloperCredentialRecord | null>;
  findAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }): Promise<AgentCredentialRecord | null>;
  touchDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }): Promise<boolean>;
  touchAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }): Promise<boolean>;
  findUser(input: { tenantId: string; issuer: string; subject: string }): Promise<UserIdentityRecord | null>;
  createDeveloper(input: CreateDeveloperInput): Promise<boolean>;
  createAgent(input: CreateAgentInput): Promise<AgentRecord | null>;
  listAgents(input: { tenantId: string; developerId: string }): Promise<AgentRecord[]>;
  getAgent(input: { tenantId: string; developerId: string; agentId: string }): Promise<AgentRecord | null>;
  createAgentCredential(input: { tenantId: string; developerId: string; credential: AgentCredentialWrite }): Promise<boolean>;
  revokeAgentCredential(input: { tenantId: string; developerId: string; agentId: string; credentialId: string }): Promise<boolean>;
  rotateAgentCredential(input: { tenantId: string; developerId: string; agentId: string; oldCredentialId: string; credential: AgentCredentialWrite }): Promise<boolean>;
  revokeDeveloperCredential(input: { tenantId: string; developerId: string; credentialId: string }): Promise<boolean>;
  rotateDeveloperCredential(input: { tenantId: string; developerId: string; oldCredentialId: string; credential: DeveloperCredentialWrite }): Promise<boolean>;
  close(): Promise<void>;
}

export type DeveloperPrincipal = {
  kind: "developer";
  tenantId: string;
  developerId: string;
  credentialId: string;
  scopes: string[];
};

export type AgentPrincipal = {
  kind: "agent";
  tenantId: string;
  developerId: string;
  agentId: string;
  credentialId: string;
  scopes: string[];
};

export type UserPrincipal = {
  kind: "user";
  tenantId: string;
  userId: string;
  role: "owner" | "admin" | "member";
  issuer: string;
  subject: string;
};

export type Principal = DeveloperPrincipal | AgentPrincipal | UserPrincipal;
