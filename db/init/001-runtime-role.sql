-- Local-only runtime role. The migration administrator remains separate from the API role.
CREATE ROLE agentlogin_app
  LOGIN
  PASSWORD 'local_app_only'
  NOSUPERUSER
  NOBYPASSRLS;

GRANT CONNECT ON DATABASE agentlogin TO agentlogin_app;
GRANT USAGE ON SCHEMA public TO agentlogin_app;

ALTER DEFAULT PRIVILEGES FOR ROLE agentlogin_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agentlogin_app;

ALTER DEFAULT PRIVILEGES FOR ROLE agentlogin_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO agentlogin_app;
