import { describe, expect, it } from "vitest";
import {
  ApplicationCredentialAuthenticationError, ApplicationCredentialService,
  type ApplicationAccessTokenRecord, type ApplicationCredentialRepository,
  type DeveloperApplicationRecord
} from "./index.js";

class MemoryApplications implements ApplicationCredentialRepository {
  applications = new Map<string, DeveloperApplicationRecord>();
  tokens = new Map<string, ApplicationAccessTokenRecord>();
  async insertApplication(input: { applicationId: string; tenantId: string; userId: string; developerId: string; name: string; clientId: string; clientSecretHash: Uint8Array }) {
    this.applications.set(input.applicationId, {
      applicationId: input.applicationId, tenantId: input.tenantId, developerId: input.developerId, clientId: input.clientId,
      clientSecretHash: input.clientSecretHash, applicationStatus: "active", developerStatus: "active", tenantStatus: "active"
    });
  }
  async findApplication(id: string, tenantId: string) {
    const row = this.applications.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async insertAccessToken(input: { tokenId: string; tenantId: string; applicationId: string; tokenHash: Uint8Array; scopes: string[]; expiresAt: Date }) {
    const app = this.applications.get(input.applicationId)!;
    this.tokens.set(input.tokenId, {
      ...input, tokenId: input.tokenId, developerId: app.developerId, revokedAt: null,
      applicationStatus: app.applicationStatus, developerStatus: app.developerStatus, tenantStatus: app.tenantStatus
    });
  }
  async findAccessToken(id: string, tenantId: string) {
    const row = this.tokens.get(id);
    return row?.tenantId === tenantId ? row : null;
  }
  async updateAccessTokenLastUsed() {}
}

const now = () => new Date("2026-11-09T12:00:00.000Z");
const key = Buffer.alloc(32, 9);

describe("developer application OAuth credentials", () => {
  it("creates a one-time client secret, exchanges it, and authenticates a short-lived application token", async () => {
    const repository = new MemoryApplications();
    const service = new ApplicationCredentialService(repository, key, now);
    const credentials = await service.create({ tenantId: "ten_1", userId: "usr_1", developerId: "dev_1", name: "Test integration" });
    expect(credentials.clientId).toMatch(/^al_client_/);
    expect(credentials.clientSecret).toMatch(/^al_secret_/);
    const token = await service.exchange({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
    expect(token.token_type).toBe("Bearer");
    expect(token.expires_in).toBe(900);
    await expect(service.authenticate(token.access_token)).resolves.toMatchObject({
      tenantId: "ten_1", developerId: "dev_1", applicationId: credentials.applicationId,
      scopes: ["agents:manage"]
    });
    expect(Buffer.from(repository.applications.get(credentials.applicationId)!.clientSecretHash).toString("utf8")).not.toContain(credentials.clientSecret);
  });

  it("rejects an incorrect client secret and a modified application token", async () => {
    const service = new ApplicationCredentialService(new MemoryApplications(), key, now);
    const credentials = await service.create({ tenantId: "ten_1", userId: "usr_1", developerId: "dev_1", name: "Test integration" });
    await expect(service.exchange({ clientId: credentials.clientId, clientSecret: "al_secret_wrong" }))
      .rejects.toBeInstanceOf(ApplicationCredentialAuthenticationError);
    const token = await service.exchange({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
    const modified = token.access_token.slice(0, -1) + (token.access_token.endsWith("A") ? "B" : "A");
    await expect(service.authenticate(modified)).rejects.toBeInstanceOf(ApplicationCredentialAuthenticationError);
  });

  it("rejects a client ID signed with a different key", async () => {
    const repository = new MemoryApplications();
    const issuer = new ApplicationCredentialService(repository, key, now);
    const credentials = await issuer.create({ tenantId: "ten_1", userId: "usr_1", developerId: "dev_1", name: "Test integration" });
    const verifier = new ApplicationCredentialService(repository, Buffer.alloc(32, 8), now);
    await expect(verifier.exchange({ clientId: credentials.clientId, clientSecret: credentials.clientSecret }))
      .rejects.toBeInstanceOf(ApplicationCredentialAuthenticationError);
  });

  it("rejects an expired application token", async () => {
    const repository = new MemoryApplications();
    const issuer = new ApplicationCredentialService(repository, key, now, 60);
    const credentials = await issuer.create({ tenantId: "ten_1", userId: "usr_1", developerId: "dev_1", name: "Test integration" });
    const token = await issuer.exchange({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
    const later = new ApplicationCredentialService(repository, key, () => new Date(now().getTime() + 60_000), 60);
    await expect(later.authenticate(token.access_token)).rejects.toBeInstanceOf(ApplicationCredentialAuthenticationError);
  });
});
