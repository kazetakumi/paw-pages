import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { hasSession, type DueItem, type Entry, type Pet } from "../api";
import { Stamp } from "../entries/due";
import { PetAvatar } from "../pets/PetAvatar";
import { formatDate, summaryOf } from "../pets/pet";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../landing/landing.css";

/* The record on this page is the app's own. A `Pet`, `Entry` values and a
   `DueItem` exactly as the API returns them, drawn by the components and the
   helpers every other screen draws them with — so a visitor arriving here is
   looking at the thing itself rather than a picture of it. It is hard-coded
   because a visitor has no session and there is nothing to fetch. */

const BISCUIT: Pet = {
  id: "sample",
  name: "Biscuit",
  species: "dog",
  breed: "Indian Pariah",
  sex: "male",
  date_of_birth: "2022-03-12",
  dob_is_approx: true,
  colour: "Tan & white",
  slug: "biscuit-a4f2",
  is_public: true,
  has_photo: false,
  age_years: 4,
  age_months: 0,
};

const LOGGED: Entry[] = [
  {
    id: "e1",
    pet_id: BISCUIT.id,
    title: "Deworming",
    happened_on: "2026-08-12",
    due_on: null,
    vet: null,
    note: "Half tablet, took it in cheese.",
    is_overdue: false,
  },
  {
    id: "e2",
    pet_id: BISCUIT.id,
    title: "Vet visit",
    happened_on: "2026-06-02",
    due_on: null,
    vet: "Anvayaa Clinic",
    note: "Limping on the back right leg. Nothing found.",
    is_overdue: false,
  },
  {
    id: "e3",
    pet_id: BISCUIT.id,
    title: "DHPP booster",
    happened_on: "2026-04-20",
    due_on: "2029-04-20",
    vet: "Anvayaa Clinic",
    note: "Batch 4471-B. Next due Apr 2029.",
    is_overdue: false,
  },
  {
    id: "e4",
    pet_id: BISCUIT.id,
    title: "Grooming",
    happened_on: "2026-03-18",
    due_on: null,
    vet: null,
    note: "Full clip and nails.",
    is_overdue: false,
  },
];

const RABIES: DueItem = {
  entry_id: "e5",
  pet_id: BISCUIT.id,
  pet_name: BISCUIT.name,
  title: "Rabies booster",
  due_on: "2026-07-14",
  days_until: -46,
  is_overdue: true,
  happened_on: "2025-07-14",
  vet: "Anvayaa Clinic",
};

/** The claim the whole product rests on, and the reason there is no reminder
 *  system to build. */
const QUIET =
  "Paw Pages sends no email and no notification. Due dates sit at the top of " +
  "your home screen and overdue ones are stamped. That is the whole system — " +
  "and it is why Paw Pages never needs your phone number.";

const KEPT: ReactNode[] = [
  <>
    <b>A date for what happened</b>, and optionally a date for the next one.
  </>,
  <>
    <b>A note in your own words</b> — batch numbers, what the vet said, how she took it.
  </>,
  <>
    <b>A photo and the basics</b> — breed, colour, sex, when they were born.
  </>,
  <>
    <b>Pets who have passed on stay</b>, archived, with their history intact.
  </>,
];

const NEVER: ReactNode[] = [
  <>
    Every pet's due dates, <b>on one screen</b>, oldest problem first.
  </>,
  <>
    Overdue is <b>impossible to miss</b> and stays until you deal with it.
  </>,
  <>
    Archived pets <b>stop counting</b>. Nothing nags you about a dog you have buried.
  </>,
];

const HANDOVER: ReactNode[] = [
  <>
    Off by default. <b>You turn it on per pet</b>, and off again whenever.
  </>,
  <>
    Archiving a pet <b>takes their page offline</b> the same moment.
  </>,
  <>
    Deleting your account <b>kills every link</b> immediately.
  </>,
];

/** The pet record itself: the avatar, the summary line and the dates, all of
 *  them the app's own. The one stamp the page is allowed lives here. */
function Record() {
  return (
    <section className="doc" aria-label="Pet record">
      <div className="kicker">Pet record</div>
      <div className="id">
        <PetAvatar pet={BISCUIT} />
        <div>
          <div className="nm">{BISCUIT.name}</div>
          <div className="sub">{summaryOf(BISCUIT)}</div>
        </div>
      </div>
      <div className="rec">
        {LOGGED.slice(0, 3).map((entry) => (
          <div className="r" key={entry.id}>
            <span className="date">{formatDate(entry.happened_on)}</span>
            <span className="w">{entry.title}</span>
          </div>
        ))}
        <div className="r over">
          <span className="date">{formatDate(RABIES.due_on)}</span>
          <span className="w">{RABIES.title}</span>
          <Stamp item={RABIES} short />
        </div>
      </div>
      <div className="foot">
        <span>Updated {formatDate(LOGGED[0]!.happened_on)}</span>
        <span className="mk">PawPages</span>
      </div>
    </section>
  );
}

/** The same entries again, this time with the note the handler wrote. */
function Entries() {
  return (
    <div className="list">
      {LOGGED.map((entry) => (
        <div className="li" key={entry.id}>
          <span className="date">{formatDate(entry.happened_on)}</span>
          <span className="t">
            <b>{entry.title}</b>
            <span>{entry.note}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** What a public page shows and what it never shows. */
function Handover() {
  return (
    <div className="mini">
      <div className="u">pawpages.app/p/{BISCUIT.slug}</div>
      <div className="yes">
        <span className="mk">Shows</span> Photo, name, breed, colour, age
      </div>
      <div className="yes">
        <span className="mk" /> Every entry — the date and what it was
      </div>
      <div className="no">
        <span className="mk">Never</span> Your name, email or phone number
      </div>
      <div className="no">
        <span className="mk" /> Your notes, or which vet you use
      </div>
    </div>
  );
}

function Head({ no, title, sub }: { no: string; title: string; sub: string }) {
  return (
    <>
      <div className="shead">
        <span className="no">{no}</span>
        <h2>{title}</h2>
      </div>
      <p className="sub">{sub}</p>
    </>
  );
}

function Truths({ items }: { items: ReactNode[] }) {
  return (
    <ul className="truths">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function Wordmark() {
  return (
    <span className="wordmark">
      Paw<span className="p2">Pages</span>
    </span>
  );
}

/** Above the breakpoint: the pitch and the record side by side, and each
 *  section a sample beside the plain truths about it. */
function LandingDesktop() {
  return (
    <div className="landing" data-layout="desktop">
      <header className="topbar">
        <Wordmark />
        <Link className="tlink" to="/signin">
          Sign in
        </Link>
        <Link className="btn" to="/signup">
          Create an account
        </Link>
      </header>

      <div className="hero">
        <div>
          <div className="eyebrow">Pet records</div>
          <h1>
            One page per pet.<span className="b">Every date on it.</span>
          </h1>
          <p className="lede">
            Shots, vet visits, deworming, grooming — each logged with the day it happened
            and the day the next one is due. Open Paw Pages and you can see what is overdue
            in one look.
          </p>
          <div className="cta">
            <Link className="btn lg" to="/signup">
              Create an account
            </Link>
            <Link className="btn lg ghost" to="/signin">
              Sign in
            </Link>
          </div>
          <div className="fine">Works in your browser · Nothing to install</div>
        </div>
        <Record />
      </div>

      <section className="s">
        <Head
          no="01"
          title="Not just the shots"
          sub="A page holds anything worth remembering about a pet. Type whatever the thing was — the app does not make you pick from a list."
        />
        <div className="two">
          <Entries />
          <Truths items={KEPT} />
        </div>
      </section>

      <section className="s">
        <Head no="02" title="It will not chase you" sub={QUIET} />
        <Truths items={NEVER} />
      </section>

      <section className="s">
        <Head
          no="03"
          title="Hand someone the link"
          sub="Switch a pet's page on and you get a URL you can send to a kennel, a sitter, or your sister. It shows the pet and the record — nothing about you."
        />
        <div className="two">
          <Handover />
          <Truths items={HANDOVER} />
        </div>
      </section>

      <div className="close">
        <h2>Start with one pet.</h2>
        <p>
          Add them, log the last shot you remember, and you are already ahead of the paper
          card.
        </p>
        <Link className="btn lg" to="/signup">
          Create an account
        </Link>
      </div>

      <footer>
        <Wordmark />
        <Link to="/signin">Sign in</Link>
        <Link to="/signup">Create an account</Link>
      </footer>
    </div>
  );
}

/** Below it: one column the whole way down. The record follows the pitch
 *  rather than sitting beside it, and the buttons are full width. */
function LandingMobile() {
  return (
    <div className="landing" data-layout="mobile">
      <header className="topbar">
        <Wordmark />
        <Link className="tlink" to="/signin">
          Sign in
        </Link>
      </header>

      <div className="hero">
        <div className="eyebrow">Pet records</div>
        <h1>
          One page per pet.<span className="b">Every date on it.</span>
        </h1>
        <p className="lede">
          Shots, vet visits, deworming, grooming — each logged with the day it happened and
          the day the next one is due.
        </p>
        <div className="cta">
          <Link className="btn" to="/signup">
            Create an account
          </Link>
          <Link className="btn ghost" to="/signin">
            Sign in
          </Link>
        </div>
        <div className="fine">Works in your browser · Nothing to install</div>
      </div>

      <Record />

      <section className="s">
        <Head
          no="01"
          title="Not just the shots"
          sub="A page holds anything worth remembering. Type whatever the thing was — no picking from a list."
        />
        <Entries />
        <Truths items={KEPT} />
      </section>

      <section className="s">
        <Head no="02" title="It will not chase you" sub={QUIET} />
        <Truths items={NEVER} />
      </section>

      <section className="s">
        <Head
          no="03"
          title="Hand someone the link"
          sub="Switch a pet's page on and you get a URL for a kennel, a sitter, or your sister. It shows the pet — nothing about you."
        />
        <Handover />
        <Truths items={HANDOVER} />
      </section>

      <div className="close">
        <h2>Start with one pet.</h2>
        <p>
          Add them, log the last shot you remember, and you are already ahead of the paper
          card.
        </p>
        <Link className="btn" to="/signup">
          Create an account
        </Link>
      </div>

      <footer>
        <Wordmark />
        <Link to="/signin">Sign in</Link>
        <Link to="/signup">Create an account</Link>
      </footer>
    </div>
  );
}

export default function Landing() {
  const isDesktop = useIsDesktop();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // "Am I signed in" is only ever answered by the API, and until it has
  // answered nothing is drawn — a handler with a session should never see the
  // landing page flash past on the way to their own home screen.
  useEffect(() => {
    hasSession().then(setSignedIn);
  }, []);

  if (signedIn === null) return null;
  if (signedIn) return <Navigate to="/home" replace />;

  const Layout = isDesktop ? LandingDesktop : LandingMobile;
  return <Layout />;
}
