import { useState, type ChangeEvent, type ReactNode } from "react";
import {
  ApiError,
  entryPhotoUrl,
  FieldError,
  removeEntryPhoto,
  uploadEntryPhoto,
  type Entry,
  type EntryFields,
  type Pet,
} from "../api";
import { useIsDesktop } from "../shell/useIsDesktop";
import { addMonths, INTERVALS, shiftDays, today } from "./entry";

type Props = {
  pets: Pet[];
  /** What the form opens filled in with: the entry being corrected, or the
   *  outstanding item "log the next one" was started from. */
  entry?: Partial<EntryFields>;
  /** The pet the form was opened from, pre-selected. */
  petId?: string;
  /** The entry being corrected, when there is one. Only the photo needs it:
   *  a new entry has no id to hang one on until it has been saved. */
  entryId?: string;
  hasPhoto?: boolean;
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

/** The bucket's own allowed types, so the picker offers what it will take. */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";

/** One form for a rabies booster, a vet visit and a nail trim, and the same
 *  form for correcting one afterwards. The title is typed, never picked. */
export function EntryForm({
  pets,
  entry,
  petId,
  entryId,
  hasPhoto = false,
  titles = [],
  save,
  onSaved,
  onCancel,
}: Props) {
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
    photo_is_public: entry?.photo_is_public ?? false,
  });
  const [problem, setProblem] = useState<Error | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  // A photo needs an entry to hang on, so a new one is saved first and the
  // upload follows. Holding what came back means a retry after a failed
  // upload retries the upload, rather than writing the entry twice.
  const [written, setWritten] = useState<Entry | null>(null);
  const [carries, setCarries] = useState(hasPhoto);
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
      const saved =
        written ??
        (await save({
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
          photo_is_public: fields.photo_is_public,
        }));
      if (!photo) return onSaved(saved);
      // Only a photo needs the entry remembered: if the upload fails, the
      // next Save retries just the upload instead of writing a second entry.
      setWritten(saved);
      onSaved(await uploadEntryPhoto(saved.id, photo));
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

  async function dropPhoto() {
    if (!entryId) return;
    await removeEntryPhoto(entryId);
    setCarries(false);
    setPhoto(null);
  }

  const picture = (
    <Field
      id="photo"
      label={
        <>
          Photo
          <Optional />
        </>
      }
      problem={rejected("photo")}
    >
      {/* Shown only when the entry already has one: a new entry has nothing to
          fetch until it has been saved. */}
      {entryId && carries && !photo && (
        <img className="shot" src={entryPhotoUrl(entryId)} alt="" />
      )}
      <input
        id="photo"
        className="file"
        type="file"
        accept={ACCEPT}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          setPhoto(event.target.files?.[0] ?? null)
        }
        {...flag("photo")}
      />
      <span className="hint">JPEG, PNG, WebP or HEIC, up to 5 MB.</span>
      {(photo || carries) && (
        <div className="pub">
          <label>
            <input
              type="checkbox"
              checked={fields.photo_is_public}
              onChange={(event) => set({ photo_is_public: event.target.checked })}
            />{" "}
            Show this photo on the public page
          </label>
          <p className="warn">
            Anyone with the link can see it. A vaccination certificate usually shows your own
            name, address and phone number.
          </p>
        </div>
      )}
      {entryId && carries && (
        <button className="rm" type="button" onClick={dropPhoto}>
          Remove photo
        </button>
      )}
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
      {/* One order in both, as of v1.1: the record first, then the two optional
          attachments. The two dates are adjacent because they are the same
          widget and the due-date chips count from the one above. Desktop keeps
          the drawn date-and-vet pairing on one row; mobile stacks the same
          sequence. `design/` still shows the v1 arrangement. */}
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
          {weight}
          {picture}
        </>
      ) : (
        <>
          {pet}
          {title}
          {date}
          {vet}
          {due}
          {note}
          {weight}
          {picture}
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
