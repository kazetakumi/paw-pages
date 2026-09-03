import { useState, type ReactNode } from "react";
import { ApiError, FieldError, type Entry, type EntryFields, type Pet } from "../api";
import { useIsDesktop } from "../shell/useIsDesktop";
import { addMonths, INTERVALS, shiftDays, today } from "./entry";

type Props = {
  pets: Pet[];
  /** What the form opens filled in with: the entry being corrected, or the
   *  outstanding item "log the next one" was started from. */
  entry?: Partial<EntryFields>;
  /** The pet the form was opened from, pre-selected. */
  petId?: string;
  /** Titles the handler has used before. Their own words, never a vocabulary.
   *  The edit form offers none: a correction already has its words. */
  titles?: string[];
  onSaved: (entry: Entry) => void;
  save: (fields: EntryFields) => Promise<Entry>;
  onCancel?: () => void;
};

function Field({
  id,
  label,
  problem,
  children,
}: {
  id: string;
  label: ReactNode;
  problem: string | null;
  children: ReactNode;
}) {
  return (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      {children}
      {problem && (
        <p className="problem" id={`${id}-problem`}>
          {problem}
        </p>
      )}
    </div>
  );
}

const Optional = () => <span className="opt"> optional</span>;

/** One form for a rabies booster, a vet visit and a nail trim, and the same
 *  form for correcting one afterwards. The title is typed, never picked. */
export function EntryForm({ pets, entry, petId, titles = [], save, onSaved, onCancel }: Props) {
  const [fields, setFields] = useState({
    pet_id: entry?.pet_id ?? petId ?? pets[0]?.id ?? "",
    title: entry?.title ?? "",
    happened_on: entry?.happened_on ?? today(),
    due_on: entry?.due_on ?? "",
    vet: entry?.vet ?? "",
    note: entry?.note ?? "",
    weight_value: entry?.weight_value ?? "",
    // A unit with no number is not sent, so a default here costs nothing
    // and saves the common case a decision.
    weight_unit: entry?.weight_unit ?? "kg",
  });
  const [problem, setProblem] = useState<Error | null>(null);
  const isDesktop = useIsDesktop();

  const set = (patch: Partial<typeof fields>) => setFields((was) => ({ ...was, ...patch }));

  const rejected = (field: string) =>
    problem instanceof FieldError && problem.field === field ? problem.message : null;

  const flag = (field: string): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    rejected(field) ? { "aria-invalid": true, "aria-describedby": `${field}-problem` } : {};

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem(null);
    try {
      onSaved(
        await save({
          pet_id: fields.pet_id,
          title: fields.title.trim(),
          happened_on: fields.happened_on,
          due_on: fields.due_on || null,
          vet: fields.vet.trim() || null,
          note: fields.note.trim() || null,
          // Both or neither, so the database's weight_is_complete stays a
          // backstop rather than something the handler ever runs into.
          weight_value: fields.weight_value.trim() || null,
          weight_unit: fields.weight_value.trim() ? fields.weight_unit : null,
        }),
      );
    } catch (failure) {
      if (failure instanceof FieldError || failure instanceof ApiError) setProblem(failure);
      else throw failure;
    }
  }

  const pet = (
    <Field id="pet_id" label="Pet" problem={rejected("pet_id")}>
      <select
        id="pet_id"
        value={fields.pet_id}
        onChange={(event) => set({ pet_id: event.target.value })}
        {...flag("pet_id")}
      >
        {pets.map((one) => (
          <option key={one.id} value={one.id}>
            {one.name}
          </option>
        ))}
      </select>
    </Field>
  );

  const title = (
    <Field id="title" label="What happened" problem={rejected("title")}>
      <input
        id="title"
        value={fields.title}
        onChange={(event) => set({ title: event.target.value })}
        placeholder="Rabies booster, nail trim, vet visit…"
        required
        {...flag("title")}
      />
      {titles.length > 0 && (
        <div className="chips">
          <span className="hint">You&rsquo;ve used</span>
          {titles.map((used) => (
            <button
              key={used}
              className="chip"
              type="button"
              onClick={() => set({ title: used })}
            >
              {used}
            </button>
          ))}
        </div>
      )}
    </Field>
  );

  const date = (
    <Field id="happened_on" label="Date" problem={rejected("happened_on")}>
      <input
        id="happened_on"
        type="date"
        value={fields.happened_on}
        onChange={(event) => set({ happened_on: event.target.value })}
        required
        {...flag("happened_on")}
      />
      <div className="chips">
        <button className="chip" type="button" onClick={() => set({ happened_on: today() })}>
          Today
        </button>
        <button
          className="chip"
          type="button"
          onClick={() => set({ happened_on: shiftDays(today(), -1) })}
        >
          Yesterday
        </button>
      </div>
    </Field>
  );

  const vet = (
    <Field
      id="vet"
      label={
        <>
          Vet or clinic
          <Optional />
        </>
      }
      problem={rejected("vet")}
    >
      <input
        id="vet"
        value={fields.vet}
        onChange={(event) => set({ vet: event.target.value })}
        {...flag("vet")}
      />
    </Field>
  );

  const due = (
    <div className="due">
      <Field
        id="due_on"
        label={
          <>
            Next one due
            <Optional />
          </>
        }
        problem={rejected("due_on")}
      >
        <input
          id="due_on"
          type="date"
          value={fields.due_on}
          onChange={(event) => set({ due_on: event.target.value })}
          {...flag("due_on")}
        />
        <div className="chips">
          <span className="hint">Set to</span>
          {INTERVALS.map(({ label, months }) => (
            <button
              key={label}
              className="chip"
              type="button"
              onClick={() => set({ due_on: addMonths(fields.happened_on, months) })}
            >
              {label}
            </button>
          ))}
          <button className="chip" type="button" onClick={() => set({ due_on: "" })}>
            Nothing due after this
          </button>
        </div>
      </Field>
      {/* Only once a date is actually set, and it says all three things a due
          date does — including the one it will never do. */}
      {fields.due_on && (
        <p className="promise">
          This appears under Due &amp; overdue on your home screen, and stays there until you log
          the next one. Paw Pages never emails you about it.
        </p>
      )}
    </div>
  );

  const weight = (
    <Field
      id="weight_value"
      label={
        <>
          Weight
          <Optional />
        </>
      }
      problem={rejected("weight_value")}
    >
      <div className="weight">
        <input
          id="weight_value"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={fields.weight_value}
          onChange={(event) => set({ weight_value: event.target.value })}
          {...flag("weight_value")}
        />
        <label className="sr" htmlFor="weight_unit">
          Unit
        </label>
        <select
          id="weight_unit"
          value={fields.weight_unit}
          onChange={(event) => set({ weight_unit: event.target.value })}
        >
          <option value="kg">kg</option>
          <option value="lb">lb</option>
        </select>
      </div>
    </Field>
  );

  const note = (
    <Field
      id="note"
      label={
        <>
          Notes
          <Optional />
        </>
      }
      problem={rejected("note")}
    >
      <textarea
        id="note"
        value={fields.note}
        onChange={(event) => set({ note: event.target.value })}
        {...flag("note")}
      />
    </Field>
  );

  return (
    <form className="petform entryform" onSubmit={onSubmit}>
      {/* The drawn desktop screen pairs the date with the vet on one row and
          puts the vet above the due date; the mobile one stacks and reorders. */}
      {isDesktop ? (
        <>
          {pet}
          {title}
          <div className="row2">
            {date}
            {vet}
          </div>
          {weight}
          {due}
          {note}
        </>
      ) : (
        <>
          {pet}
          {title}
          {date}
          {weight}
          {due}
          {vet}
          {note}
        </>
      )}

      <div className="acts">
        <button className="btn" type="submit">
          Save
        </button>
        {onCancel && (
          <button className="btn ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {problem instanceof ApiError && (
        <p className="problem" role="alert">
          {problem.message}
        </p>
      )}
    </form>
  );
}
