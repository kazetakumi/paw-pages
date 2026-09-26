-- Moves a conversation's turns out of pawpages_conversations.transcript and
-- into their own table, one row per turn. v2.
--
-- Additive, per rule 9: one new table. transcript stays in place, unused
-- from here on -- dropping it is a column drop, which rule 9 doesn't allow
-- against the live project. It held zero rows when this ran, so there was
-- nothing to copy across.
--
-- Reasoning lives in dbschema/conversations.html and dbschema/messages.html.


-- ============================================================================
-- pawpages_messages
-- ============================================================================
-- One row per turn. id is an identity rather than a uuid because it's also
-- the order: a user turn and its reply are written in the same transaction,
-- and now() is the transaction's start time, so created_at ties.

create table pawpages_messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references pawpages_conversations (id) on delete cascade,
  handler_id       uuid not null references pawpages_handlers (id) on delete cascade,

  role             text not null check (role in ('user', 'assistant')),
  content          jsonb not null,

  created_at       timestamptz not null default now()
);

comment on column pawpages_messages.handler_id is
  'Copied from the conversation so the RLS policy is a plain column check '
  'rather than a join on every read.';
comment on column pawpages_messages.content is
  'The turn''s content as the model sees it: a JSON string for plain text, '
  'or an array of content blocks once tool calls are kept.';

-- a conversation's turns, in order
create index pawpages_messages_conversation_idx
  on pawpages_messages (conversation_id, id);

alter table pawpages_messages enable row level security;

-- with check also requires the conversation to be the handler's own, so a
-- turn can't be written into someone else's thread under your own id.
-- The subquery sees only the handler's conversations, through that table's
-- own RLS.
create policy pawpages_handler_owns_messages on pawpages_messages
  for all to authenticated
  using (handler_id = (select auth.uid()))
  with check (
    handler_id = (select auth.uid())
    and exists (select 1 from pawpages_conversations c where c.id = conversation_id)
  );

comment on column pawpages_conversations.transcript is
  'Unused since 0010 -- turns live in pawpages_messages. Left in place '
  'because rule 9 forbids dropping a column on the live project.';
