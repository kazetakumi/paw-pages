-- Replaces pawpages_messages.role with a type column so tool calls and
-- their outputs are stored alongside the user and assistant messages. v2.
--
-- Drops a column, which rule 9 normally rules out. It's allowed here
-- because pawpages_messages is v2-only, was created by 0010 the same day,
-- holds zero rows, and nothing live reads it -- v1 can't observe any of
-- this. The new not null column is safe for the same reason: no rows to
-- backfill.
--
-- Reasoning lives in dbschema/messages.html.

alter table pawpages_messages
  drop column role,
  add column type text not null check (
    type in ('user_message', 'assistant_message', 'function_call', 'function_call_output')
  );

comment on column pawpages_messages.type is
  'Which kind of item content holds. Named after the Responses API''s own '
  'item types, so the column and the jsonb use one vocabulary.';
comment on column pawpages_messages.content is
  'The whole item exactly as it is replayed to the model -- a '
  '{role, content} message, a function_call, or a function_call_output.';
