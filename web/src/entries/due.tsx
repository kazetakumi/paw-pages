import { Link } from "react-router-dom";
import type { DueItem } from "../api";
import { formatDate } from "../pets/pet";
import { useIsDesktop } from "../shell/useIsDesktop";
import "./due.css";

/** How far past its date, off the day count the database sent. Overdue is
 *  decided in the `due_items` view; this only turns its sign around. */
const daysOverdue = (item: DueItem) => -item.days_until;

const dueIn = (days: number) =>
  days === 0 ? "Due today" : `In ${days} ${days === 1 ? "day" : "days"}`;

/** The rubber-stamp impression, the one place stamp red is used. */
function Stamp({ item, short }: { item: DueItem; short?: boolean }) {
  return (
    <span className="stamp">
      Overdue{" "}
      <span className="days">
        {daysOverdue(item)}
        {short ? "d" : " days"}
      </span>
    </span>
  );
}

function What({ item }: { item: DueItem }) {
  return (
    <span className="what">
      <b>{item.pet_name}</b>
      <span className="slash" aria-hidden="true">
        /
      </span>
      <span className="kind">{item.title}</span>
    </span>
  );
}

/** Above the breakpoint: a ruled table, the date in its own column. */
function LedgerDesktop({ items }: { items: DueItem[] }) {
  return (
    <div className="ledger" data-layout="desktop">
      {items.map((item) => (
        <Link
          className={item.is_overdue ? "lrow over" : "lrow"}
          key={item.entry_id}
          to={`/pets/${item.pet_id}`}
        >
          <span className="date">{formatDate(item.due_on)}</span>
          <What item={item} />
          {item.is_overdue ? <Stamp item={item} /> : <span className="when">{dueIn(item.days_until)}</span>}
        </Link>
      ))}
    </div>
  );
}

/** Below it: stacked cards, the date labelled because it has no column. */
function LedgerMobile({ items }: { items: DueItem[] }) {
  return (
    <div className="ledger" data-layout="mobile">
      {items.map((item) => (
        <Link
          className={item.is_overdue ? "lrow over" : "lrow"}
          key={item.entry_id}
          to={`/pets/${item.pet_id}`}
        >
          <span className="date">Due {formatDate(item.due_on)}</span>
          <What item={item} />
          {item.is_overdue ? (
            <Stamp item={item} short />
          ) : (
            <span className="when">{dueIn(item.days_until)}</span>
          )}
        </Link>
      ))}
    </div>
  );
}

/** Every pet's outstanding due dates, oldest problem first — in the order the
 *  API sent them, which is the order `due_items` is read in. */
export function Ledger({ items }: { items: DueItem[] }) {
  const Rows = useIsDesktop() ? LedgerDesktop : LedgerMobile;
  if (items.length === 0) return null;
  return (
    <section aria-label="Due and overdue">
      <div className="sect">
        <h2>Due &amp; overdue</h2>
        <span className="line" />
        <span className="n">{items.length}</span>
      </div>
      <Rows items={items} />
    </section>
  );
}

/** One outstanding item on the pet's own page, with the two ways to close it.
 *  Same view as the home ledger, so the feed and the ledger cannot disagree. */
export function Attention({
  item,
  onLogNext,
  onMarkDone,
}: {
  item: DueItem;
  onLogNext: () => void;
  onMarkDone: () => void;
}) {
  const isDesktop = useIsDesktop();
  return (
    <div
      className={item.is_overdue ? "attention over" : "attention"}
      data-layout={isDesktop ? "desktop" : "mobile"}
    >
      <div className="dt">Due {formatDate(item.due_on)}</div>
      <div className="dw">{item.title}</div>
      <div className="ds">
        Last given <span className="d">{formatDate(item.happened_on)}</span>
        {item.vet && ` at ${item.vet}`}.
      </div>
      <div className="dacts">
        <button className="mini" type="button" onClick={onLogNext}>
          Log the next one
        </button>
        <button className="mini q" type="button" onClick={onMarkDone}>
          Mark done
        </button>
      </div>
      {item.is_overdue && <Stamp item={item} short={!isDesktop} />}
    </div>
  );
}
