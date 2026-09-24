import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { hasSession } from "../api";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../landing/landing.css";

/* This page has no session and nothing to fetch, so every example below —
   the chat mock, the entry lists, the public-page preview — is the same
   fixed copy design/v2/landing ships. The one thing that must stay real is
   the example slug in the footer link and the public-page mock: it points
   at a pet page that actually exists (see pet-about.test.tsx). */

const EXAMPLE_SLUG = "biscuit-a4f2";

type EntryItem = { date: string; title: string; note: string; tag?: string };

const SECTION1_ITEMS: EntryItem[] = [
  { date: "12 AUG 2026", title: "Deworming", note: "Half tablet, took it in cheese." },
  {
    date: "23 SEP 2026",
    title: "Training",
    note: 'Learned "sit" and "stay" this week.',
    tag: "Milestone",
  },
  { date: "20 APR 2026", title: "DHPP booster", note: "Batch 4471-B. Next due Apr 2029." },
  { date: "18 MAR 2026", title: "Grooming", note: "Full clip and nails." },
];

const SECTION1_TRUTHS: ReactNode[] = [
  <>
    <b>A date for what happened</b>, and a due date if there's a next one.
  </>,
  <>
    <b>Milestones and vet visits</b> live in the same timeline — tagged, not siloed.
  </>,
  <>
    <b>Attach a photo or a vet note</b> and it's filed under that pet automatically.
  </>,
  <>
    <b>Pets who've passed on stay</b>, archived, with their history intact.
  </>,
];

type StatusItem = { date: string; pet: string; kind: string; status: string };

const SECTION2_ITEMS: StatusItem[] = [
  { date: "14 JUL 2026", pet: "Biscuit", kind: "Rabies booster", status: "Overdue by 46 days" },
  { date: "05 SEP 2026", pet: "Momo", kind: "Deworming", status: "In 7 days" },
  { date: "21 SEP 2026", pet: "Pepper", kind: "DHPP booster", status: "In 23 days" },
];

const SECTION2_TRUTHS_DESKTOP: ReactNode[] = [
  <>
    Every pet's due dates, <b>oldest problem first</b>, the moment you show up.
  </>,
  <>
    Overdue stays overdue <b>until you say it's handled</b> — stamped, impossible to miss.
  </>,
  <>
    Archived pets <b>stop counting</b>. Nothing nags you about a dog you've buried.
  </>,
  <>
    Prefer a list to a conversation? <b>The dashboard's still there.</b>
  </>,
];

const SECTION2_TRUTHS_MOBILE: ReactNode[] = [
  <>
    Every pet's due dates, <b>oldest problem first</b>, the moment you show up.
  </>,
  <>
    Overdue stays overdue <b>until you say it's handled</b>.
  </>,
  <>
    Archived pets <b>stop counting</b>.
  </>,
  <>
    Prefer a list to a conversation? <b>The dashboard's still there.</b>
  </>,
];

const SECTION3_TRUTHS: ReactNode[] = [
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

/** The brand mark and wordmark, undressed — every caller wraps it in its own
 *  container (`.brand` in the topbar and footer, `.cm-top` in the chat mock),
 *  same as design/v2/landing does. */
function Brand() {
  return (
    <>
      <span className="brand-mark" aria-hidden="true">
        P
      </span>
      <span className="brand-word">
        Paw<span className="p2">Pages</span>
      </span>
    </>
  );
}

/** The hero's visual: a miniature, non-interactive recreation of the chat
 *  screen a signed-in handler actually sees at /home. Identical at both
 *  breakpoints — landing.css resizes it under [data-layout="mobile"]. */
function ChatMock() {
  return (
    <div className="chatmock">
      <div className="cm-top">
        <Brand />
      </div>
      <div className="cm-body">
        <p className="cm-text">Welcome back. One thing needs attention:</p>
        <div className="cm-card over">
          <span className="cm-w">
            <b>Biscuit</b> <span>/ Rabies booster</span>
          </span>
          <span className="cm-stamp">OVERDUE</span>
        </div>
        <div className="cm-bubble">Biscuit had his deworming today — no issues.</div>
        <p className="cm-text">Logged. Here's the entry:</p>
        <div className="cm-card">
          <span className="cm-w">
            <b>Biscuit</b> <span>/ Deworming</span>
          </span>
          <span className="cm-due">Due 23 Dec</span>
        </div>
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

/** Section 01's sample: a note logged in the handler's own words, whatever
 *  the thing was. */
function EntryList({ items }: { items: EntryItem[] }) {
  return (
    <div className="list">
      {items.map((item) => (
        <div className="li" key={item.title}>
          <span className="d">{item.date}</span>
          <span className="t">
            <b>{item.title}</b>
            <span>{item.note}</span>
            {item.tag && <span className="tag">{item.tag}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Section 02's sample: the same due-date rows the home screen greets a
 *  handler with. */
function StatusList({ items }: { items: StatusItem[] }) {
  return (
    <div className="list">
      {items.map((item) => (
        <div className="li" key={item.pet + item.kind}>
          <span className="d">{item.date}</span>
          <span className="t">
            <b>{item.pet}</b> — {item.kind} <span>{item.status}</span>
          </span>
        </div>
      ))}
    </div>
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

/** Section 03's sample: what a public pet page shows, and what it never does. */
function Mini() {
  return (
    <div className="mini">
      <div className="u">pawpages.app/p/{EXAMPLE_SLUG}</div>
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

/** Above the breakpoint: the pitch and the chat mock side by side, and each
 *  section a sample beside the plain truths about it. */
function LandingDesktop() {
  return (
    <div className="landing" data-layout="desktop">
      <header className="topbar">
        <span className="brand">
          <Brand />
        </span>
        <Link className="tlink" to="/signin">
          Sign in
        </Link>
        <Link className="btn" to="/signup">
          Create an account
        </Link>
      </header>

      <div className="hero">
        <div>
          <div className="eyebrow">Pet records, conversationally</div>
          <h1>
            Tell it what happened.<span className="b">It keeps the record.</span>
          </h1>
          <p className="lede">
            Vaccinations, vet visits, a new trick learned on a Tuesday — just say it. Paw
            Pages works out the date, tags what matters, and tells you the moment
            something's overdue.
          </p>
          <div className="cta">
            <Link className="btn lg" to="/signup">
              Create an account
            </Link>
            <Link className="btn lg ghost" to="/home">
              See an example
            </Link>
          </div>
          <div className="fine">Works in your browser · Nothing to install</div>
        </div>
        <ChatMock />
      </div>

      <section className="s">
        <Head
          no="01"
          title="Not a form to fill in"
          sub="Say what happened in your own words. The agent works out the title, the date, and files a photo or vet note if you send one — no dropdowns, no required fields."
        />
        <div className="two">
          <EntryList items={SECTION1_ITEMS} />
          <Truths items={SECTION1_TRUTHS} />
        </div>
      </section>

      <section className="s">
        <Head
          no="02"
          title="It tells you before you ask"
          sub="No emails. No notifications. No red dot on your phone at 7am. Open a new chat and if anything's overdue, that's the first thing you hear."
        />
        <div className="two">
          <StatusList items={SECTION2_ITEMS} />
          <Truths items={SECTION2_TRUTHS_DESKTOP} />
        </div>
      </section>

      <section className="s">
        <Head
          no="03"
          title="Hand someone the link"
          sub="Switch a pet's page on and you get a URL you can send to a kennel, a sitter, or your sister. It shows the pet and the record — nothing about you."
        />
        <div className="two">
          <Mini />
          <Truths items={SECTION3_TRUTHS} />
        </div>
      </section>

      <div className="close">
        <h2>Start with one pet.</h2>
        <p>Tell it their last shot, and you're already ahead of the paper card.</p>
        <Link className="btn lg" to="/signup">
          Create an account
        </Link>
      </div>

      <footer>
        <span className="brand">
          <Brand />
        </span>
        <Link to="/signin">Sign in</Link>
        <Link to="/signup">Create an account</Link>
        <Link to={`/p/${EXAMPLE_SLUG}`}>Example pet page</Link>
      </footer>
    </div>
  );
}

/** Below it: one column the whole way down, the chat mock following the
 *  pitch rather than sitting beside it, and the buttons full width. */
function LandingMobile() {
  return (
    <div className="landing" data-layout="mobile">
      <header className="topbar">
        <span className="brand">
          <Brand />
        </span>
        <Link className="tlink" to="/signin">
          Sign in
        </Link>
      </header>

      <div className="hero">
        <div className="eyebrow">Pet records, conversationally</div>
        <h1>
          Tell it what happened.<span className="b">It keeps the record.</span>
        </h1>
        <p className="lede">
          Vaccinations, vet visits, a new trick learned on a Tuesday — just say it. Paw
          Pages works out the date, tags what matters, and tells you the moment
          something's overdue.
        </p>
        <div className="cta">
          <Link className="btn" to="/signup">
            Create an account
          </Link>
          <Link className="btn ghost" to="/home">
            See an example
          </Link>
        </div>
        <div className="fine">Works in your browser · Nothing to install</div>
        <ChatMock />
      </div>

      <section className="s">
        <Head
          no="01"
          title="Not a form to fill in"
          sub="Say what happened in your own words. The agent works out the title, the date, and files a photo or vet note if you send one."
        />
        <EntryList items={SECTION1_ITEMS.slice(0, 3)} />
        <Truths items={SECTION1_TRUTHS} />
      </section>

      <section className="s">
        <Head
          no="02"
          title="It tells you before you ask"
          sub="No emails. No notifications. Open a new chat and if anything's overdue, that's the first thing you hear."
        />
        <StatusList items={SECTION2_ITEMS.slice(0, 2)} />
        <Truths items={SECTION2_TRUTHS_MOBILE} />
      </section>

      <section className="s">
        <Head
          no="03"
          title="Hand someone the link"
          sub="Switch a pet's page on and you get a URL you can send to a kennel, a sitter, or your sister. It shows the pet and the record — nothing about you."
        />
        <Mini />
        <Truths items={SECTION3_TRUTHS} />
      </section>

      <div className="close">
        <h2>Start with one pet.</h2>
        <p>Tell it their last shot, and you're already ahead of the paper card.</p>
        <Link className="btn" to="/signup">
          Create an account
        </Link>
      </div>

      <footer>
        <span className="brand">
          <Brand />
        </span>
        <Link to="/signin">Sign in</Link>
        <Link to="/signup">Create an account</Link>
        <Link to={`/p/${EXAMPLE_SLUG}`}>Example pet page</Link>
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
