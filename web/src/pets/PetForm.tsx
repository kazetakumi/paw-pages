import { useState, type ReactNode } from "react";
import { ApiError, FieldError, type Pet, type PetFields } from "../api";

type Props = {
  pet?: Pet;
  submit: string;
  save: (fields: PetFields) => Promise<Pet>;
  onSaved: (pet: Pet) => void;
  onCancel?: () => void;
};

function Field({ id, label, problem, children }: {
  id: string;
  label: string;
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

/** The identity fields, whether the pet exists yet or not. A name and a
 *  species are all the database asks for; everything else can come later. */
export function PetForm({ pet, submit, save, onSaved, onCancel }: Props) {
  const [problem, setProblem] = useState<Error | null>(null);

  const rejected = (field: string) =>
    problem instanceof FieldError && problem.field === field ? problem.message : null;

  const flag = (field: string): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    rejected(field) ? { "aria-invalid": true, "aria-describedby": `${field}-problem` } : {};

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const optional = (name: string) => text(name) || null;
    setProblem(null);
    try {
      onSaved(
        await save({
          name: text("name"),
          species: text("species"),
          breed: optional("breed"),
          sex: optional("sex") as PetFields["sex"],
          date_of_birth: optional("date_of_birth"),
          dob_is_approx: form.get("dob_is_approx") === "on",
          colour: optional("colour"),
        }),
      );
    } catch (failure) {
      if (failure instanceof FieldError || failure instanceof ApiError) setProblem(failure);
      else throw failure;
    }
  }

  return (
    <form className="petform" onSubmit={onSubmit}>
      <Field id="name" label="Name" problem={rejected("name")}>
        <input id="name" name="name" defaultValue={pet?.name ?? ""} required {...flag("name")} />
      </Field>

      <Field id="species" label="Species" problem={rejected("species")}>
        <input
          id="species"
          name="species"
          defaultValue={pet?.species ?? ""}
          placeholder="dog, cat, tortoise…"
          required
          {...flag("species")}
        />
      </Field>

      <Field id="breed" label="Breed" problem={rejected("breed")}>
        <input id="breed" name="breed" defaultValue={pet?.breed ?? ""} {...flag("breed")} />
      </Field>

      <Field id="sex" label="Sex" problem={rejected("sex")}>
        <select id="sex" name="sex" defaultValue={pet?.sex ?? ""} {...flag("sex")}>
          <option value="">Not recorded</option>
          <option value="male">male</option>
          <option value="female">female</option>
        </select>
      </Field>

      <Field id="date_of_birth" label="Date of birth" problem={rejected("date_of_birth")}>
        <input
          id="date_of_birth"
          name="date_of_birth"
          type="date"
          defaultValue={pet?.date_of_birth ?? ""}
          {...flag("date_of_birth")}
        />
      </Field>

      <div className="f check">
        <input
          id="dob_is_approx"
          name="dob_is_approx"
          type="checkbox"
          defaultChecked={pet?.dob_is_approx ?? false}
          {...flag("dob_is_approx")}
        />
        <label htmlFor="dob_is_approx">The date of birth is approximate</label>
        {rejected("dob_is_approx") && (
          <p className="problem" id="dob_is_approx-problem">
            {rejected("dob_is_approx")}
          </p>
        )}
      </div>

      <Field id="colour" label="Colour" problem={rejected("colour")}>
        <input id="colour" name="colour" defaultValue={pet?.colour ?? ""} {...flag("colour")} />
      </Field>

      <div className="acts">
        <button className="btn" type="submit">
          {submit}
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
