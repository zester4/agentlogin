import { describe, expect, it } from "vitest";
import { authorizeGrant, type AuthorizationContext } from "./index.js";
const context = (): AuthorizationContext => ({
  tenantId:"ten_1", userId:"usr_1", authenticatedAgentId:"agt_1", requestedAccountId:"acc_1",
  requestedOrigin:"https://example.com", requestedScope:"autofill_login", now:new Date("2026-01-01T00:00:00Z"),
  grant:{tenantId:"ten_1",userId:"usr_1",agentId:"agt_1",accountId:"acc_1",origin:"https://example.com",
    scopes:["autofill_login"],expiresAt:new Date("2026-01-01T00:05:00Z"),revokedAt:null,approvedAt:new Date("2025-12-31T23:00:00Z")}
});
describe("grant authorization", () => {
  it("allows an exact active grant", () => expect(authorizeGrant(context())).toEqual({allowed:true}));
  it("rejects a different agent", () => expect(authorizeGrant({...context(),authenticatedAgentId:"agt_other"})).toMatchObject({allowed:false,reason:"agent_mismatch"}));
  it("rejects a different origin", () => expect(authorizeGrant({...context(),requestedOrigin:"https://evil.example.com"})).toMatchObject({allowed:false,reason:"origin_mismatch"}));
  it("rejects expiry", () => expect(authorizeGrant({...context(),now:new Date("2027-01-01")})).toMatchObject({allowed:false,reason:"expired"}));
  it("rejects revocation", () => expect(authorizeGrant({...context(),grant:{...context().grant,revokedAt:new Date()}})).toMatchObject({allowed:false,reason:"revoked"}));
});
