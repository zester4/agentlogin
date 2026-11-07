const value = process.env.DATABASE_URL_UNPOOLED;
if (!value) {
  throw new Error(
    "DATABASE_URL_UNPOOLED is required for migrations. Use Neon's direct (non-pooler) connection string.",
  );
}
const parsed = new URL(value);
if (parsed.hostname.includes("-pooler")) {
  throw new Error(
    "Refusing to run migrations through a pooled Neon connection. Use DATABASE_URL_UNPOOLED.",
  );
}
