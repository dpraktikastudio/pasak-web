ALTER TABLE training_examples
  ADD COLUMN source_expense_id uuid,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX training_examples_install_source_expense_uidx
  ON training_examples (install_id, source_expense_id)
  WHERE source_expense_id IS NOT NULL;
