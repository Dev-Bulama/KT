// Integration tests use a dedicated database. Never point this at production.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://katdict:katdict@localhost:5432/katdict_test";
process.env.AUTH_SECRET = "test-only-secret-0123456789abcdef0123456789abcdef";
process.env.APP_URL = "http://localhost:3000";
process.env.EMAIL_PROVIDER = "console";
process.env.STORAGE_DRIVER = "local";
process.env.AI_PROVIDER = "disabled";
process.env.LOG_LEVEL = "error";
