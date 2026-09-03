-- An optional weight on an entry. v1.1.0.
--
-- Weight earns columns rather than living in `note` because it is the one
-- thing here a machine reads: the reason to record it repeatedly is to compare
-- readings over time, and a number inside 2000 characters of prose cannot be
-- ordered or subtracted. `note` stays the place for everything only a person
-- reads.
--
-- It hangs off `entries` rather than getting a table of its own because a
-- weight is a thing that happened on a day — which is what an entry already
-- is. Most readings are taken at a vet visit, so they belong to that row.
--
-- Additive by design: both columns are new and nullable, and every read in the
-- backend names its columns (`ENTRY_COLUMNS`, `public.ENTRIES`,
-- `export.ENTRIES`), so v1 running against this same database cannot see them.
-- `public_entries` is deliberately left alone — a weight is not for visitors,
-- and widening that view would not be additive.
--
-- Units are stored as the handler typed them, never normalised to grams. It is
-- the rule dates already follow: record what you were given and let display
-- convert. kg and lb only; a pet weighed in grams is out of scope, and
-- widening the check later is a live-table migration.

alter table entries
  add column weight_value numeric(5, 2)
    check (weight_value is null or weight_value > 0),
  add column weight_unit text
    check (weight_unit in ('kg', 'lb'));

-- A number with no unit is not a weight. Mirrors `archive_is_complete` on
-- `pets`: the pair travels together or neither is there. Valid immediately
-- because both columns are null on every existing row.
alter table entries
  add constraint weight_is_complete check (
    (weight_value is null and weight_unit is null) or
    (weight_value is not null and weight_unit is not null)
  );
