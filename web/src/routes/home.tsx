import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMe, listPets, Unauthorized, type Handler, type Pet } from "../api";
import { initial, summaryOf } from "../pets/pet";
import { Shell } from "../shell/Shell";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";

// The three tints the cards alternate through, as drawn.
const TINTS = ["a", "b", "c"];

function Avatar({ pet, index }: { pet: Pet; index: number }) {
  // No photo yet, so the initial is the portrait.
  return (
    <span className={`av ${TINTS[index % TINTS.length]}`} aria-hidden="true">
      {initial(pet.name)}
    </span>
  );
}

/** Above the breakpoint: a grid of cards. */
function PetsDesktop({ pets }: { pets: Pet[] }) {
  return (
    <div className="pets">
      {pets.map((pet, index) => (
        <Link className="pet" key={pet.id} to={`/pets/${pet.id}/about`}>
          <span className="top">
            <Avatar pet={pet} index={index} />
            <span className="id">
              <span className="nm">{pet.name}</span>
              <span className="sub">{summaryOf(pet)}</span>
            </span>
          </span>
        </Link>
      ))}
      <Link className="pet add" to="/pets/new">
        <span className="pl" aria-hidden="true">
          +
        </span>
        <span className="tx">Add a pet</span>
      </Link>
    </div>
  );
}

/** Below it: rows, not a grid. */
function PetsMobile({ pets }: { pets: Pet[] }) {
  return (
    <>
      {pets.length > 0 && (
        <div className="pets">
          {pets.map((pet, index) => (
            <Link className="pet" key={pet.id} to={`/pets/${pet.id}/about`}>
              <Avatar pet={pet} index={index} />
              <span className="mid">
                <span className="nm">{pet.name}</span>
                <span className="sub">{summaryOf(pet)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      <Link className="addpet" to="/pets/new">
        <span className="pl" aria-hidden="true">
          +
        </span>
        <span className="tx">Add a pet</span>
      </Link>
    </>
  );
}

export default function Home() {
  const [record, setRecord] = useState<{ handler: Handler; pets: Pet[] } | null>(null);
  const Pets = useIsDesktop() ? PetsDesktop : PetsMobile;

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    Promise.all([getMe(), listPets()])
      .then(([handler, pets]) => setRecord({ handler, pets }))
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, []);

  if (!record) return null;

  return (
    <Shell name={record.handler.name}>
      <h1 className="greeting">Your pets</h1>
      <Pets pets={record.pets} />
    </Shell>
  );
}
