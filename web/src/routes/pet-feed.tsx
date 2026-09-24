import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getMe,
  getPet,
  listEntries,
  markDone,
  Unauthorized,
  type DueItem,
  type Entry,
  type Handler,
  type PetRecord,
} from "../api";
import { Attention } from "../entries/due";
import { formatDate, formatDayMonth, summaryOf } from "../pets/pet";
import { PetAvatar } from "../pets/PetAvatar";
import { Shell } from "../shell/Shell";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";
import "../pets/pet-profile.css";

/** The tag chips a history row carries. There is genuinely no milestone field
 *  on an entry, so no milestone tag is ever drawn — only what the API sent. */
function Tags({ entry }: { entry: Entry }) {
  if (!entry.due_on && !entry.vet) return null;
  return (
    <span className="tags">
      {entry.due_on && (
        <span className={entry.is_overdue ? "tag late" : "tag next"}>
          Next due {formatDate(entry.due_on)}
          {entry.is_overdue && " — overdue"}
        </span>
      )}
      {entry.vet && <span className="tag vet">{entry.vet}</span>}
    </span>
  );
}

/** One thing that happened: the date on the left, what it was beside it. A
 *  row whose own due date has passed is marked the same way the panel above
 *  it is, so the feed and "Needs attention" can never disagree.
 *
 *  Desktop stacks the year under the day and wraps what happened in a second
 *  column; the narrow layout keeps the date on one line and everything else
 *  beneath it, as each drawing has it. */
function EntryRow({ entry }: { entry: Entry }) {
  const isDesktop = useIsDesktop();
  const what = (
    <>
      <span className="ttl">{entry.title}</span>
      {entry.note && <span className="note">{entry.note}</span>}
      <Tags entry={entry} />
    </>
  );
  return (
    <div className={entry.is_overdue ? "ent over" : "ent"}>
      {isDesktop ? (
        <>
          <span className="when">
            {formatDayMonth(entry.happened_on)}
            <span className="yr">{entry.happened_on.slice(0, 4)}</span>
          </span>
          <span>{what}</span>
        </>
      ) : (
        <>
          <span className="when">{formatDate(entry.happened_on)}</span>
          {what}
        </>
      )}
    </div>
  );
}

/** The pet's own header: avatar, name, the breed/sex/age line, and the one
 *  way in to change anything about this pet now — chat. */
function Phead({ pet }: { pet: PetRecord }) {
  const isDesktop = useIsDesktop();
  const cta = (
    <Link className="btn" to="/home?new=1">
      Chat about {pet.name}
    </Link>
  );
  return isDesktop ? (
    <div className="phead">
      <PetAvatar pet={pet} />
      <div className="id">
        <h1>{pet.name}</h1>
        <div className="meta">{summaryOf(pet)}</div>
      </div>
      <div className="pacts">{cta}</div>
    </div>
  ) : (
    <div className="phead">
      <div className="phead-top">
        <PetAvatar pet={pet} />
        <div>
          <h1>{pet.name}</h1>
          <div className="meta">{summaryOf(pet)}</div>
        </div>
      </div>
      {cta}
    </div>
  );
}

export default function PetFeed() {
  const { id = "" } = useParams();
  const [record, setRecord] = useState<{ handler: Handler; pet: PetRecord } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  // The API's cursor, held as it came and handed straight back. A pet with
  // years of history opens on what is recent; the rest arrives on request.
  const [older, setOlder] = useState<string | null>(null);

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    Promise.all([getMe(), getPet(id), listEntries(id)])
      .then(([handler, pet, page]) => {
        setRecord({ handler, pet });
        setEntries(page.entries);
        setOlder(page.next_cursor);
      })
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, [id]);

  async function showOlder() {
    const page = await listEntries(id, older);
    setEntries((shown) => [...shown, ...page.entries]);
    setOlder(page.next_cursor);
  }

  async function done(item: DueItem) {
    const entry = await markDone(item.entry_id);
    setRecord((was) =>
      was && {
        ...was,
        pet: {
          ...was.pet,
          due_items: was.pet.due_items.filter((one) => one.entry_id !== item.entry_id),
        },
      },
    );
    setEntries((shown) => shown.map((one) => (one.id === entry.id ? entry : one)));
  }

  if (!record) return null;
  const { pet } = record;

  return (
    <Shell name={record.handler.name} title={pet.name} width="pet">
      <Link className="back" to="/dashboard">
        &larr; Dashboard
      </Link>
      <Phead pet={pet} />

      <nav className="tabs" aria-label="Pet">
        <span className="tab on">Feed</span>
        <Link className="tab" to={`/pets/${pet.id}/about`}>
          About
        </Link>
      </nav>

      {pet.due_items.length > 0 && (
        <>
          <div className="sect">
            <h2>Needs attention</h2>
            <span className="line" />
            <span className="n">{pet.due_items.length}</span>
          </div>
          {pet.due_items.map((item) => (
            <Attention key={item.entry_id} item={item} onMarkDone={() => done(item)} />
          ))}
        </>
      )}

      <div className="sect">
        <h2>History</h2>
        <span className="line" />
        <span className="n">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
      </div>
      {entries.length === 0 ? (
        <p className="lede">Nothing logged yet.</p>
      ) : (
        <div className="hist">
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))}
          {older && (
            <button className="more" type="button" onClick={showOlder}>
              Show older entries
            </button>
          )}
        </div>
      )}

      <p className="danger">
        <Link to={`/pets/${pet.id}/about`}>Archive {pet.name}</Link>
      </p>
    </Shell>
  );
}
