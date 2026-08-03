-- Persist the exact player-visible input authorized by Portia and the Gate.
-- This deliberately excludes provider/system instructions, credentials, and
-- the structured-output contract that may accompany the input at generation.
ALTER TABLE gate_decisions
  ADD COLUMN IF NOT EXISTS answer_user_prompt text,
  ADD COLUMN IF NOT EXISTS answer_user_prompt_sha256 char(64);

ALTER TABLE gate_decisions
  DROP CONSTRAINT IF EXISTS gate_decisions_answer_user_prompt_valid;

ALTER TABLE gate_decisions
  ADD CONSTRAINT gate_decisions_answer_user_prompt_valid
    CHECK (
      (
        answer_user_prompt IS NULL
        AND answer_user_prompt_sha256 IS NULL
      )
      OR (
        passed
        AND char_length(answer_user_prompt) BETWEEN 1 AND 200000
        AND answer_user_prompt_sha256 ~ '^[0-9a-f]{64}$'
      )
    );

COMMENT ON COLUMN gate_decisions.answer_user_prompt IS
  'Exact player-visible Answer input authorized by Portia and Gate; excludes provider/system instructions and secrets.';

COMMENT ON COLUMN gate_decisions.answer_user_prompt_sha256 IS
  'SHA-256 of answer_user_prompt UTF-8 bytes.';
