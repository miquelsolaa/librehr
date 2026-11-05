-- Coverage policies are opt-in; existing departments remain unconfigured.
ALTER TABLE departments ADD COLUMN min_presence_percent integer;
ALTER TABLE departments ADD CONSTRAINT departments_min_presence_percent_range
  CHECK (min_presence_percent IS NULL OR min_presence_percent BETWEEN 0 AND 100);
