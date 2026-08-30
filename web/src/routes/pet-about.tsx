import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { getMe, getPet, updatePet, Unauthorized, type Handler, type Pet } from "../api";
import { ageOf, formatDate, initial, summaryOf } from "../pets/pet";
import { PetForm } from "../pets/PetForm";
import { Shell } from "../shell/Shell";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";

type LayoutProps = { pet: Pet; onEdit: () => void; form: ReactNode };

function Value({ text }: { text: string | null }) {
  return text ? <span className="v">{text}</span> : <span className="v empty">Not recorded</span>;
}

/** Above the breakpoint: a label column, the age its own aside. */
function AboutDesktop({ pet, onEdit, form }: LayoutProps) {
  return (
    <div className="about">
      <Link className="back" to="/home">
        &larr; Home
      </Link>
      <div className="phead">
        <span className="av" aria-hidden="true">
          {initial(pet.name)}
        </span>
        <div className="id">
          <h1>{pet.name}</h1>
          <div className="meta">{summaryOf(pet)}</div>
        </div>
        {!form && (
          <div className="pacts">
            <button className="btn ghost" type="button" onClick={onEdit}>
              Edit
            </button>
          </div>
        )}
      </div>

      <nav className="tabs" aria-label="Pet">
        <Link className="tab" to={`/pets/${pet.id}`}>
          Feed
        </Link>
        <span className="tab on">About</span>
      </nav>

      <div className="sect">
        <h2>Identity</h2>
        <span className="line" />
      </div>
      {form ?? (
        <div className="card">
          <div className="row">
            <span className="k">Species</span>
            <Value text={pet.species} />
          </div>
          <div className="row">
            <span className="k">Breed</span>
            <Value text={pet.breed} />
          </div>
          <div className="row">
            <span className="k">Sex</span>
            <Value text={pet.sex} />
          </div>
          <div className="row">
            <span className="k">Date of birth</span>
            {pet.date_of_birth ? (
              <span className="v mono">
                {formatDate(pet.date_of_birth)}
                {pet.dob_is_approx && <span className="approx">approx.</span>}
                <span className="derived">{ageOf(pet)}</span>
              </span>
            ) : (
              <Value text={null} />
            )}
          </div>
          <div className="row">
            <span className="k">Colour</span>
            <Value text={pet.colour} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Below it: the label and the value on one line, the age under the date. */
function AboutMobile({ pet, onEdit, form }: LayoutProps) {
  return (
    <div className="about">
      <div className="crumbs">
        <Link className="back" to="/home">
          &larr; Home
        </Link>
        {!form && (
          <button className="ed" type="button" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>

      <div className="hero">
        <span className="av" aria-hidden="true">
          {initial(pet.name)}
        </span>
        <div>
          <h1>{pet.name}</h1>
          <div className="meta">{summaryOf(pet)}</div>
        </div>
      </div>

      <nav className="tabs" aria-label="Pet">
        <Link className="tab" to={`/pets/${pet.id}`}>
          Feed
        </Link>
        <span className="tab on">About</span>
      </nav>

      <div className="sect">
        <h2>Identity</h2>
        <span className="line" />
      </div>
      {form ?? (
        <div className="card">
          <div className="row">
            <span className="k">Species</span>
            <Value text={pet.species} />
          </div>
          <div className="row">
            <span className="k">Breed</span>
            <Value text={pet.breed} />
          </div>
          <div className="row">
            <span className="k">Sex</span>
            <Value text={pet.sex} />
          </div>
          <div className="row">
            <span className="k">Born</span>
            {pet.date_of_birth ? (
              <span className="v mono">
                {formatDate(pet.date_of_birth)}
                <span className="approx">
                  {[pet.dob_is_approx ? "approx." : null, ageOf(pet)].filter(Boolean).join(" · ")}
                </span>
              </span>
            ) : (
              <Value text={null} />
            )}
          </div>
          <div className="row">
            <span className="k">Colour</span>
            <Value text={pet.colour} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function PetAbout() {
  const { id = "" } = useParams();
  const [record, setRecord] = useState<{ handler: Handler; pet: Pet } | null>(null);
  const [editing, setEditing] = useState(false);
  const About = useIsDesktop() ? AboutDesktop : AboutMobile;

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    Promise.all([getMe(), getPet(id)])
      .then(([handler, pet]) => setRecord({ handler, pet }))
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, [id]);

  if (!record) return null;
  const { handler, pet } = record;

  return (
    <Shell name={handler.name}>
      <About
        pet={pet}
        onEdit={() => setEditing(true)}
        form={
          editing ? (
            <PetForm
              pet={pet}
              submit="Save"
              save={(fields) => updatePet(pet.id, fields)}
              onSaved={(saved) => {
                setRecord({ handler, pet: saved });
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : null
        }
      />
    </Shell>
  );
}
