import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getDashboard,
  getMe,
  Unauthorized,
  type Dashboard,
  type DueItem,
  type Handler,
  type PetCard,
} from "../api";
import { formatDate, summaryOf } from "../pets/pet";
import { PetAvatar } from "../pets/PetAvatar";
import { Shell } from "../shell/Shell";
import { Bone } from "../shell/Skeleton";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";

// The three tints the cards alternate through, as drawn.
const TINTS = ["a", "b", "c"];

function Avatar({ pet, index }: { pet: PetCard; index: number }) {
  return <PetAvatar pet={pet} tint={TINTS[index % TINTS.length]} />;
}

/** How many days past its date an overdue item is, off the day count the API
 *  sent — this only turns its sign around. */
const daysOverdue = (item: DueItem) => -item.days_until;

const dueIn = (days: number) =>
  days === 0 ? "Due today" : `In ${days} ${days === 1 ? "day" : "days"}`;

/** One outstanding item: the date, the pet and what it's for, then either a
 *  countdown or the rubber-stamp impression.
 *
 *  Built locally rather than imported from entries/due.tsx: that file and its
 *  CSS belong to the pet-profile screens, worked on in parallel. */
function LedgerRow({ item, isDesktop }: { item: DueItem; isDesktop: boolean }) {
  return (
    <Link className={item.is_overdue ? "lrow over" : "lrow"} to={`/pets/${item.pet_id}`}>
      <span className="date">
        {isDesktop ? formatDate(item.due_on) : `Due ${formatDate(item.due_on)}`}
      </span>
      <span className="what">
        <b>{item.pet_name}</b>
        <span className="slash" aria-hidden="true">
          /
        </span>
        <span className="kind">{item.title}</span>
      </span>
      {item.is_overdue ? (
        <span className="stamp">
          Overdue{" "}
          <span className="days">
            {daysOverdue(item)}
            {isDesktop ? " days" : "d"}
          </span>
        </span>
      ) : (
        <span className="when">{dueIn(item.days_until)}</span>
      )}
    </Link>
  );
}

/** Every pet's outstanding due dates, oldest problem first — the order the
 *  API sent them in. */
function Ledger({ items, isDesktop }: { items: DueItem[]; isDesktop: boolean }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Due and overdue">
      <div className="sect">
        <h2>Due &amp; overdue</h2>
        <span className="line" />
        <span className="n">{items.length}</span>
      </div>
      <div className="ledger" data-layout={isDesktop ? "desktop" : "mobile"}>
        {items.map((item) => (
          <LedgerRow key={item.entry_id} item={item} isDesktop={isDesktop} />
        ))}
      </div>
    </section>
  );
}

/** One pet, closed with its next due and last logged dates — the same card at
 *  both breakpoints; only the grid it sits in, below, changes shape. */
function PetCardEl({ pet, index }: { pet: PetCard; index: number }) {
  return (
    <Link className="pet" to={`/pets/${pet.id}`}>
      <span className="top">
        <Avatar pet={pet} index={index} />
        <span>
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
  );
}

/** The grid above the breakpoint, the stacked column below it — the pet cards
 *  themselves never change shape, only the container around them. */
function Pets({ pets, isDesktop }: { pets: PetCard[]; isDesktop: boolean }) {
  return (
    <div className="pets" data-layout={isDesktop ? "desktop" : "mobile"}>
      {pets.map((pet, index) => (
        <PetCardEl key={pet.id} pet={pet} index={index} />
      ))}
      <Link className="pet add" to="/home?new=1">
        <span className="pl" aria-hidden="true">
          +
        </span>
        <span className="tx">Add a pet</span>
      </Link>
    </div>
  );
}

/** The summary line: three counts the API sent, never counted again here. */
function Tally({ board }: { board: Dashboard }) {
  return (
    <div className="tally">
      {board.active_pets} ACTIVE <i aria-hidden="true">&middot;</i>{" "}
      <span className={board.overdue > 0 ? "hot" : undefined}>{board.overdue} OVERDUE</span>{" "}
      <i aria-hidden="true">&middot;</i> {board.due_within_30_days} DUE WITHIN 30 DAYS
    </div>
  );
}

/** The names behind the archived count, each one a tap from its own record.
 *  Restoring one happens on the account screen now, not here. */
function Archived({ board }: { board: Dashboard }) {
  if (board.archived_pets === 0) return null;
  return (
    <p className="archived">
      <span>
        {board.archived_pets} archived {board.archived_pets === 1 ? "pet" : "pets"}
      </span>
      <i aria-hidden="true">&mdash;</i>
      {board.archived.map((pet, index) => (
        <span key={pet.id}>
          {index > 0 && ", "}
          <Link to={`/pets/${pet.id}`}>{pet.name}</Link>
        </span>
      ))}
    </p>
  );
}

/** The head and three blank pet cards, in the shapes the real ones take. */
function DashboardSkeleton({ isDesktop }: { isDesktop: boolean }) {
  return (
    <div className="dashboard" aria-busy="true">
      <div className="head">
        <div>
          <Bone w={150} h={28} />
          <Bone w={260} />
        </div>
      </div>
      <div className="sect">
        <h2>Pets</h2>
        <span className="line" />
      </div>
      <div className="pets" data-layout={isDesktop ? "desktop" : "mobile"}>
        {[0, 1, 2].map((i) => (
          <div className="pet" key={i}>
            <span className="top">
              <Bone className="av" />
              <span>
                <Bone w={90} h={16} />
                <Bone w={140} />
              </span>
            </span>
            <span className="foot">
              <Bone w="70%" />
              <Bone w="55%" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [record, setRecord] = useState<{ handler: Handler; board: Dashboard } | null>(null);
  const isDesktop = useIsDesktop();

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

  if (!record) {
    return (
      <Shell name="" credits={null} title="Dashboard">
        <DashboardSkeleton isDesktop={isDesktop} />
      </Shell>
    );
  }
  const { board } = record;

  return (
    <Shell name={record.handler.name} credits={record.handler.credits} title="Dashboard">
      <div className="dashboard">
        <div className="head">
          <div>
            <h1>Your pets</h1>
            <Tally board={board} />
          </div>
          <Link className="btn" to="/home?new=1">
            Add a pet
          </Link>
        </div>
        <Ledger items={board.ledger} isDesktop={isDesktop} />
        <div className="sect">
          <h2>Pets</h2>
          <span className="line" />
          <span className="n">{board.pets.length}</span>
        </div>
        <Pets pets={board.pets} isDesktop={isDesktop} />
        <Archived board={board} />
      </div>
    </Shell>
  );
}
