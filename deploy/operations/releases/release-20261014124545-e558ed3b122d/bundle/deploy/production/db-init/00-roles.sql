\getenv database POSTGRES_DB
\getenv migration_password ORIUM_MIGRATOR_PASSWORD
\getenv app_password ORIUM_APP_PASSWORD
SELECT format('CREATE ROLE orium_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', :'migration_password') \gexec
SELECT format('CREATE ROLE orium_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD %L', :'app_password') \gexec
ALTER SCHEMA public OWNER TO orium_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO orium_app;
SELECT format('ALTER DATABASE %I OWNER TO orium_migrator', :'database') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO orium_app', :'database') \gexec
