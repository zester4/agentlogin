// MCP transport and tool wiring are gated on authenticated agent identity, per-tool
// authorization, and output sanitization. Never add tools that retrieve credentials.
export const MCP_TOOL_NAMES = [
  "list_connected_accounts","request_access","login_with_grant","get_execution_status","request_user_action"
] as const;
