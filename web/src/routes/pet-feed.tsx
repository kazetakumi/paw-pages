import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { getMe, getPet, listEntries, Unauthorized, type Entry, type Handler, type Pet } from "../api";
import { formatDate, initial, summaryOf } from "../pets/pet";
import { Shell } from "../shell/Shell";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";
import "../entries/entries.css";

/** One thing that happened, as drawn: the date on the left, then what it was.
 *  Every date is formatted from the string the API gave, never re-read. */
function EntryCard({ entry }: { entry: Entry }) {
  return (
    <article className="entry">
      <div className="when">{formatDate(entry.happened_on)}</div>
      <div className="what">
        <h3>{entry.title}</h3>
        {entry.note && <p className="note">{entry.note}</p>}
        {(entry.due_on || entry.vet) && (
          <div className="tags">
            {entry.due_on && (
              <span className={entry.is_overdue ? "tag due overdue" : "tag due"}>
                Next due {formatDate(entry.due_on)}
                {entry.is_overdue && " — overdue"}
              </span>
            )}
            {entry.vet && <span className="tag vet">{entry.vet}</span>}
          </div>
        )}
      </div>
    </article>
  );
}

function Tabs({ pet }: { pet: Pet }) {
  return (
    <nav className="tabs" aria-label="Pet">
      <span className="tab on">Feed</span>
      <Link className="tab" to={`/pets/${pet.id}/about`}>
        About
      </Link>
    </nav>
  );
}

type LayoutProps = { pet: Pet; children: ReactNode };

/** Above the breakpoint: the log button sits in the pet's header. */
function FeedDesktop({ pet, children }: LayoutProps) {
  return (
    <div className="about feed">
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
        <div className="pacts">
          <Link className="btn" to={`/log?pet=${pet.id}`}>
            + Log an entry
          </Link>
        </div>
      </div>
      <Tabs pet={pet} />
      {children}
    </div>
  );
}

/** Below it: the log button is a bar under the record instead. */
function FeedMobile({ pet, children }: LayoutProps) {
  return (
    <div className="about feed">
      <div className="crumbs">
        <Link className="back" to="/home">
          &larr; Home
        </Link>
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
      <Tabs pet={pet} />
      {children}
      <Link className="logbar" to={`/log?pet=${pet.id}`}>
        + Log an entry
      </Link>
    </div>
  );
}

export default function PetFeed() {
  const { id = "" } = useParams();
  const [record, setRecord] = useState<{ handler: Handler; pet: Pet } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const Feed = useIsDesktop() ? FeedDesktop : FeedMobile;

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    Promise.all([getMe(), getPet(id), listEntries(id)])
      .then(([handler, pet, page]) => {
        setRecord({ handler, pet });
        setEntries(page.entries);
      })
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, [id]);

  if (!record) return null;

  return (
    <Shell name={record.handler.name}>
      <Feed pet={record.pet}>
        <div className="sect">
          <h2>History</h2>
          <span className="line" />
        </div>
        {entries.length === 0 ? (
          <p className="lede">Nothing logged yet.</p>
        ) : (
          <div className="entries">
            {entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </Feed>
    </Shell>
  );
}
