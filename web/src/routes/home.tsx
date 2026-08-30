import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getDashboard,
  getMe,
  Unauthorized,
  type Dashboard,
  type Handler,
  type PetCard,
} from "../api";
import { Ledger } from "../entries/due";
import { formatDate, formatDayMonth, initial, summaryOf } from "../pets/pet";
import { Shell } from "../shell/Shell";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";
import "../entries/entries.css";

// The three tints the cards alternate through, as drawn.
const TINTS = ["a", "b", "c"];

function Avatar({ pet, index }: { pet: PetCard; index: number }) {
  // No photo yet, so the initial is the portrait.
  return (
    <span className={`av ${TINTS[index % TINTS.length]}`} aria-hidden="true">
      {initial(pet.name)}
    </span>
  );
}

/** Above the breakpoint: a grid of cards, each closing with its two dates. */
function PetsDesktop({ pets }: { pets: PetCard[] }) {
  return (
    <div className="pets">
      {pets.map((pet, index) => (
        <Link className="pet" key={pet.id} to={`/pets/${pet.id}`}>
          <span className="top">
            <Avatar pet={pet} index={index} />
            <span className="id">
              <span className="nm">{pet.name}</span>
              <span className="sub">{summaryOf(pet)}</span>
            </span>
          </span>
          <span className="foot">
            <span className="fline">
              <span className="k">Next due</span>
              <span className={pet.next_due_is_overdue ? "v over" : "v"}>
                {pet.next_due_on ? formatDate(pet.next_due_on) : "Nothing due"}
              </span>
            </span>
            <span className="fline">
              <span className="k">Last logged</span>
              <span className="v">
                {pet.last_logged_on ? formatDate(pet.last_logged_on) : "Nothing yet"}
              </span>
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

/** Below it: rows, not a grid, and only the date that needs watching. */
function PetsMobile({ pets }: { pets: PetCard[] }) {
  return (
    <>
      {pets.length > 0 && (
        <div className="pets">
          {pets.map((pet, index) => (
            <Link className="pet" key={pet.id} to={`/pets/${pet.id}`}>
              <Avatar pet={pet} index={index} />
              <span className="mid">
                <span className="nm">{pet.name}</span>
                <span className="sub">{summaryOf(pet)}</span>
              </span>
              {pet.next_due_on && (
                <span className="nextdue">
                  <span className="k">Next due</span>
                  <span className={pet.next_due_is_overdue ? "v over" : "v"}>
                    {formatDayMonth(pet.next_due_on)}
                  </span>
                </span>
              )}
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

/** The summary line: three counts the API sent, never counted again here. */
function Tally({ board }: { board: Dashboard }) {
  return (
    <p className="greeting-sub">
      {board.active_pets} active
      <i aria-hidden="true">·</i>
      <span className={board.overdue > 0 ? "hot" : undefined}>{board.overdue} overdue</span>
      <i aria-hidden="true">·</i>
      {board.due_within_30_days} due within 30 days
    </p>
  );
}

export default function Home() {
  const [record, setRecord] = useState<{ handler: Handler; board: Dashboard } | null>(null);
  const Pets = useIsDesktop() ? PetsDesktop : PetsMobile;

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    // One request for the ledger, the cards and the counts: this is the page
    // the app opens on, and it is not worth three.
    Promise.all([getMe(), getDashboard()])
      .then(([handler, board]) => setRecord({ handler, board }))
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, []);

  if (!record) return null;
  const { board } = record;

  return (
    <Shell name={record.handler.name}>
      <div className="head">
        <h1 className="greeting">Your pets</h1>
        <Tally board={board} />
      </div>
      <Ledger items={board.ledger} />
      <div className="sect">
        <h2>Pets</h2>
        <span className="line" />
        <span className="n">{board.pets.length}</span>
      </div>
      <Pets pets={board.pets} />
      {board.archived_pets > 0 && (
        <p className="archived">
          {board.archived_pets} archived {board.archived_pets === 1 ? "pet" : "pets"}
        </p>
      )}
    </Shell>
  );
}
