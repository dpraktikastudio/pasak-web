CREATE TABLE consents (
  install_id uuid PRIMARY KEY,
  consent_version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE training_examples (
  id uuid PRIMARY KEY,
  install_id uuid NOT NULL REFERENCES consents (install_id),
  transcript text NOT NULL,
  prediction jsonb NOT NULL,
  correction jsonb NOT NULL,
  model_versions jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX training_examples_install_id_idx ON training_examples (install_id);
