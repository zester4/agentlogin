/**
 * Keep node-postgres and migration tooling on strict certificate and hostname
 * verification while avoiding deprecated pg-connection-string SSL aliases.
 */
export function normalizePostgresSslMode(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();

    if (sslMode && ["prefer", "require", "verify-ca"].includes(sslMode)) {
      url.searchParams.set("sslmode", "verify-full");
    }

    return url.toString();
  } catch {
    // Preserve keyword/value connection strings for node-postgres to validate.
    return connectionString;
  }
}
