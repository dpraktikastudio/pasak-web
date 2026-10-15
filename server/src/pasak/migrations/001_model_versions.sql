CREATE TABLE model_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family text NOT NULL CHECK (family IN ('whisper', 'interpreter')),
  version text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'promoted', 'superseded')),
  files jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family, version)
);

CREATE UNIQUE INDEX model_versions_one_promoted
  ON model_versions (family)
  WHERE status = 'promoted';
