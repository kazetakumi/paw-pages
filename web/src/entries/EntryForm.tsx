import { useState, type ReactNode } from "react";
import { ApiError, FieldError, type Entry, type EntryFields, type Pet } from "../api";
import { useIsDesktop } from "../shell/useIsDesktop";
import { today } from "./entry";

type Props = {
  pets: Pet[];
  /** The entry being corrected, if this is an edit rather than a new one. */
  entry?: Entry;
  /** The pet the form was opened from, pre-selected. */
  petId?: string;
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
export function EntryForm({ pets, entry, petId, save, onSaved, onCancel }: Props) {
  const [fields, setFields] = useState({
    pet_id: entry?.pet_id ?? petId ?? pets[0]?.id ?? "",
    title: entry?.title ?? "",
    happened_on: entry?.happened_on ?? today(),
    due_on: entry?.due_on ?? "",
    vet: entry?.vet ?? "",
    note: entry?.note ?? "",
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
          {due}
          {note}
        </>
      ) : (
        <>
          {pet}
          {title}
          {date}
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
