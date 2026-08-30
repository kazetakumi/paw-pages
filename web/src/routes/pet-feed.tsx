import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createEntry,
  deleteEntry,
  getMe,
  getPet,
  listEntries,
  markDone,
  Unauthorized,
  updateEntry,
  type DueItem,
  type Entry,
  type Handler,
  type PetRecord,
} from "../api";
import { Attention } from "../entries/due";
import { EntryForm } from "../entries/EntryForm";
import { formatDate, summaryOf } from "../pets/pet";
import { PetAvatar } from "../pets/PetAvatar";
import { Shell } from "../shell/Shell";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";
import "../entries/entries.css";

/** One thing that happened, as drawn: the date on the left, then what it was.
 *  Every date is formatted from the string the API gave, never re-read. */
function EntryCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: Entry;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
        <div className="acts">
          <button type="button" onClick={onEdit}>
            Edit
          </button>
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function Tabs({ pet }: { pet: PetRecord }) {
  return (
    <nav className="tabs" aria-label="Pet">
      <span className="tab on">Feed</span>
      <Link className="tab" to={`/pets/${pet.id}/about`}>
        About
      </Link>
    </nav>
  );
}

type LayoutProps = { pet: PetRecord; children: ReactNode };

/** Above the breakpoint: the log button sits in the pet's header. */
function FeedDesktop({ pet, children }: LayoutProps) {
  return (
    <div className="about feed">
      <Link className="back" to="/home">
        &larr; Home
      </Link>
      <div className="phead">
        <PetAvatar pet={pet} />
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
        <PetAvatar pet={pet} />
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
  const [record, setRecord] = useState<{ handler: Handler; pet: PetRecord } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  // The API's cursor, held as it came and handed straight back. A pet with
  // years of history opens on what is recent; the rest arrives on request.
  const [older, setOlder] = useState<string | null>(null);
  // The entry being corrected, swapped for its card until it is saved.
  const [editing, setEditing] = useState<Entry | null>(null);
  // The outstanding item being settled, swapped for the form it pre-fills.
  const [logging, setLogging] = useState<DueItem | null>(null);
  const Feed = useIsDesktop() ? FeedDesktop : FeedMobile;

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

  async function remove(entry: Entry) {
    await deleteEntry(entry.id);
    setEntries((shown) => shown.filter((one) => one.id !== entry.id));
  }

  /** Both ways of closing a due date end here: the pet, re-read, so the panel
   *  and the feed still say the same thing about it. */
  async function reload() {
    const [pet, page] = await Promise.all([getPet(id), listEntries(id)]);
    setRecord((was) => was && { ...was, pet });
    setEntries(page.entries);
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
    <Shell name={record.handler.name}>
      <Feed pet={pet}>
        {pet.due_items.length > 0 && (
          <>
            <div className="sect">
              <h2>Needs attention</h2>
              <span className="line" />
              <span className="n">{pet.due_items.length}</span>
            </div>
            {pet.due_items.map((item) =>
              logging?.entry_id === item.entry_id ? (
                <div className="attention logging" key={item.entry_id}>
                  <EntryForm
                    pets={[pet]}
                    entry={{ pet_id: item.pet_id, title: item.title, vet: item.vet }}
                    save={(fields) => createEntry(fields, item.entry_id)}
                    onSaved={() => {
                      setLogging(null);
                      return reload();
                    }}
                    onCancel={() => setLogging(null)}
                  />
                </div>
              ) : (
                <Attention
                  key={item.entry_id}
                  item={item}
                  onLogNext={() => setLogging(item)}
                  onMarkDone={() => done(item)}
                />
              ),
            )}
          </>
        )}
        <div className="sect">
          <h2>History</h2>
          <span className="line" />
        </div>
        {entries.length === 0 ? (
          <p className="lede">Nothing logged yet.</p>
        ) : (
          <div className="entries">
            {entries.map((entry) =>
              editing?.id === entry.id ? (
                <div className="entry editing" key={entry.id}>
                  <EntryForm
                    pets={[pet]}
                    entry={entry}
                    save={(fields) => updateEntry(entry.id, fields)}
                    onSaved={(saved) => {
                      setEntries((shown) =>
                        shown.map((one) => (one.id === saved.id ? saved : one)),
                      );
                      setEditing(null);
                    }}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              ) : (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  onEdit={() => setEditing(entry)}
                  onDelete={() => remove(entry)}
                />
              ),
            )}
          </div>
        )}
        {older && (
          <button className="older" type="button" onClick={showOlder}>
            Show older entries
          </button>
        )}
      </Feed>
    </Shell>
  );
}
