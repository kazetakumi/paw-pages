-- Credits: a ledger a handler's chat turns are paid from. v2.
--
-- Additive, per rule 9: one new table, two new functions. Nothing existing
-- is altered.
--
-- Reasoning lives in dbschema/credit_ledger.html.


-- ============================================================================
-- pawpages_credit_ledger
-- ============================================================================
-- One row per movement: a daily refill (+) or a chat turn's charge (-). The
-- balance is sum(credits); nothing stores it.

create table pawpages_credit_ledger (
  id               uuid primary key default gen_random_uuid(),
  handler_id       uuid not null references pawpages_handlers (id) on delete cascade,
  kind             text not null,
  credits          integer not null,

  -- refill rows only
  refill_date      date,

  -- turn rows only
  conversation_id  uuid references pawpages_conversations (id) on delete set null,
  cost_usd         numeric(12, 8),
  input_tokens     integer,
  cached_tokens    integer,
  output_tokens    integer,

  created_at       timestamptz not null default now(),

  constraint pawpages_credit_kind check (kind in ('refill', 'turn')),
  constraint pawpages_credit_refill_shape check (
    kind <> 'refill' or (refill_date is not null and credits >= 0)
  ),
  constraint pawpages_credit_turn_shape check (
    kind <> 'turn' or (refill_date is null and credits <= 0 and cost_usd is not null)
  )
);

comment on column pawpages_credit_ledger.conversation_id is
  'Set null, not cascade, on delete: deleting a conversation must not delete '
  'its charges and hand the credits back.';
comment on column pawpages_credit_ledger.refill_date is
  'The Asia/Kolkata calendar day the refill is for. A refill row is written '
  'even when it adds 0, so the day counts as refilled.';
comment on column pawpages_credit_ledger.cost_usd is
  'What the turn cost at OpenAI, before any markup -- for auditing margins.';

-- one refill per handler per day. Turn rows have a null refill_date, and
-- nulls never collide.
create unique index pawpages_credit_ledger_one_refill_idx
  on pawpages_credit_ledger (handler_id, refill_date);

-- the balance: sum(credits) for one handler
create index pawpages_credit_ledger_handler_idx
  on pawpages_credit_ledger (handler_id);

alter table pawpages_credit_ledger enable row level security;

-- Read only. No insert/update/delete policy: a handler writing here could
-- grant themselves credits, so every write goes through the two functions
-- below.
create policy pawpages_handler_reads_own_credits on pawpages_credit_ledger
  for select to authenticated
  using (handler_id = (select auth.uid()));


-- ============================================================================
-- pawpages_refill_credits()
-- ============================================================================
-- Tops the caller back up to 100, once per day, and returns the balance.
-- Safe to call from anywhere, any number of times: the unique index turns a
-- second refill on the same day -- two tabs at once included -- into nothing.

create function pawpages_refill_credits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  insert into public.pawpages_credit_ledger (handler_id, kind, credits, refill_date)
  select me, 'refill', greatest(100 - coalesce(sum(l.credits), 0), 0),
         (now() at time zone 'Asia/Kolkata')::date
  from public.pawpages_credit_ledger l
  where l.handler_id = me
  on conflict (handler_id, refill_date) do nothing;

  return (select coalesce(sum(credits), 0) from public.pawpages_credit_ledger where handler_id = me);
end;
$$;


-- ============================================================================
-- pawpages_charge_turn(...)
-- ============================================================================
-- Deducts one chat turn from the caller and returns the new balance. May go
-- a few credits negative: a turn's cost is only known once it has run.
-- p_credits is the positive amount charged; the row stores it negated, and
-- the turn-shape check refuses a negative p_credits, so nobody can use this
-- to add credits.

create function pawpages_charge_turn(
  p_conversation_id uuid,
  p_credits integer,
  p_cost_usd numeric,
  p_input_tokens integer,
  p_cached_tokens integer,
  p_output_tokens integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if not exists (
    select 1 from public.pawpages_conversations
    where id = p_conversation_id and handler_id = me
  ) then
    raise exception 'conversation not found';
  end if;

  insert into public.pawpages_credit_ledger
    (handler_id, kind, credits, conversation_id, cost_usd, input_tokens, cached_tokens, output_tokens)
  values
    (me, 'turn', -p_credits, p_conversation_id, p_cost_usd, p_input_tokens, p_cached_tokens, p_output_tokens);

  return (select coalesce(sum(credits), 0) from public.pawpages_credit_ledger where handler_id = me);
end;
$$;

-- Handlers only. PostgREST exposes anything executable in `public` as an
-- RPC; neither function does anything for a caller without auth.uid().
revoke execute on function pawpages_refill_credits() from public, anon;
revoke execute on function pawpages_charge_turn(uuid, integer, numeric, integer, integer, integer) from public, anon;
grant execute on function pawpages_refill_credits() to authenticated;
grant execute on function pawpages_charge_turn(uuid, integer, numeric, integer, integer, integer) to authenticated;
