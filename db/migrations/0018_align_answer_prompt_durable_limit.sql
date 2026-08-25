-- Keep the Gate's exact player-visible Answer input aligned with the shared
-- durable model-prompt ceiling. The structured OpenClaw transport supports
-- this envelope without placing the prompt in argv.
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
        answer_user_prompt IS NOT NULL
        AND answer_user_prompt_sha256 IS NOT NULL
        AND passed
        AND char_length(answer_user_prompt) BETWEEN 1 AND 3000000
        AND answer_user_prompt_sha256 ~ '^[0-9a-f]{64}$'
      )
    );

COMMENT ON COLUMN gate_decisions.answer_user_prompt IS
  'Exact player-visible Answer input authorized by Portia and Gate, bounded to 3000000 characters; excludes provider/system instructions and secrets.';
