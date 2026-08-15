-- Minimal application-metadata schema for regression-test purposes.
--
-- A real app-metadata catalog has dozens of tables describing entities,
-- fields, relationships, applications, users, audit logs, etc. For the
-- harness we only need enough to exercise:
--
--   • Joinery's awareness of a non-public schema (explorer tree, queries)
--   • The two regression tests from the legacy 31-suite:
--       #22  app_meta.entity with a JOIN — 20+ rows expected
--       #23  app_meta.application — 10+ rows expected
--
-- Identifiers are lowercase (PG default) so test queries can be written
-- without quoting. The meaningful thing here is shape + cardinality, not
-- byte-for-byte fidelity to any particular product's real metadata schema.

CREATE SCHEMA IF NOT EXISTS app_meta;

CREATE TABLE app_meta.user (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_meta.application (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app_meta.entity (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  base_table      TEXT NOT NULL,
  schema_name     TEXT NOT NULL DEFAULT 'public',
  application_id  INTEGER NOT NULL REFERENCES app_meta.application(id),
  owner_user_id   INTEGER NOT NULL REFERENCES app_meta.user(id),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schema_name, base_table)
);

CREATE INDEX entity_application_id_idx ON app_meta.entity (application_id);
CREATE INDEX entity_owner_user_id_idx ON app_meta.entity (owner_user_id);
