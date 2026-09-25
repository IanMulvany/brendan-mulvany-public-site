-- Keep person boxes in the orientation in which they were drawn. Existing
-- annotations predate editorial rotations and therefore start at zero turns.
ALTER TABLE annotations ADD COLUMN rotation_turns INTEGER NOT NULL DEFAULT 0
  CHECK(rotation_turns BETWEEN 0 AND 3);
