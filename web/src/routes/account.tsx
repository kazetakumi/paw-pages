import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ApiError,
  FieldError,
  Unauthorized,
  deleteAccount,
  exportUrl,
  getMe,
  signOut,
  updateEmail,
  updateMe,
  updatePassword,
  type Handler,
} from "../api";
import { formatDate } from "../pets/pet";
import { Shell } from "../shell/Shell";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";
import "../account/account.css";

/** One changeable thing about the account. `save` is the endpoint that owns it:
 *  the name and the three optional fields are columns on the handler, while the
 *  email and the password are credentials Supabase Auth owns, each with its own
 *  endpoint. `value` is what is shown, `input` is what the form starts from. */
type Detail = {
  field: string;
  label: string;
  value: string | null;
  input: string;
  mono?: boolean;
  hint?: string;
  type?: string;
  save: (value: string) => Promise<Handler | void>;
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Nothing but a blank goes back as null, which is how an optional field is
 *  cleared to unset again. */
const orNull = (value: string) => value.trim() || null;

function credentials(account: Handler): Detail[] {
  return [
    {
      field: "name",
      label: "Name",
      value: account.name,
      input: account.name,
      save: (name) => updateMe({ name }),
    },
    {
      field: "email",
      label: "Email",
      value: account.email,
      input: account.email,
      mono: true,
      type: "email",
      hint: "Used to sign in and to reset your password.",
      save: (email) => updateEmail(email),
    },
    {
      field: "password",
      label: "Password",
      value: "•".repeat(8),
      input: "",
      mono: true,
      type: "password",
      hint: "At least six characters. Changing it does not sign you out here.",
      save: (password) => updatePassword(password),
    },
  ];
}

/** Optional, unset by default, and nothing in the app branches on any of them.
 *  They are collected because they were asked for — which is why all three are
 *  named on the delete panel below. */
function aboutYou(account: Handler): Detail[] {
  return [
    {
      field: "date_of_birth",
      label: "Date of birth",
      value: account.date_of_birth && formatDate(account.date_of_birth),
      input: account.date_of_birth ?? "",
      mono: true,
      type: "date",
      hint:
        account.age === null
          ? "Your age is worked out from this, never stored."
          : `You are ${account.age}. Age is worked out from this, never stored.`,
      save: (value) => updateMe({ date_of_birth: orNull(value) }),
    },
    {
      field: "gender",
      label: "Gender",
      value: account.gender,
      input: account.gender ?? "",
      save: (value) => updateMe({ gender: orNull(value) }),
    },
    {
      field: "nationality",
      label: "Nationality",
      value: account.nationality,
      input: account.nationality ?? "",
      save: (value) => updateMe({ nationality: orNull(value) }),
    },
  ];
}

/** Change one thing. The same form under both layouts, so what the API accepts
 *  and what it refuses read the same on a phone as on a desktop. */
function DetailForm({
  detail,
  onSaved,
  onCancel,
}: {
  detail: Detail;
  onSaved: (account: Handler | void) => void;
  onCancel: () => void;
}) {
  const [problem, setProblem] = useState<Error | null>(null);
  const rejected =
    problem instanceof FieldError && problem.field === detail.field ? problem.message : null;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("value") ?? "");
    setProblem(null);
    try {
      onSaved(await detail.save(value));
    } catch (failure) {
      if (failure instanceof FieldError || failure instanceof ApiError) setProblem(failure);
      else throw failure;
    }
  }

  return (
    <form className="edit" onSubmit={onSubmit}>
      <label htmlFor={detail.field}>{detail.label}</label>
      <input
        id={detail.field}
        name="value"
        type={detail.type ?? "text"}
        defaultValue={detail.input}
        autoFocus
        {...(rejected
          ? { "aria-invalid": true as const, "aria-describedby": `${detail.field}-problem` }
          : {})}
      />
      <span className="acts">
        <button className="btn" type="submit">
          Save
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>
          Cancel
        </button>
      </span>
      {rejected && (
        <p className="problem" id={`${detail.field}-problem`}>
          {rejected}
        </p>
      )}
      {problem instanceof ApiError && (
        <p className="problem" role="alert">
          {problem.message}
        </p>
      )}
    </form>
  );
}

/** A row is either what it says or the form that changes it. The two layouts
 *  draw the row differently; the form inside it is the same either way. */
type Row = { detail: Detail; form: ReactNode | null; onEdit: () => void };

function change(detail: Detail) {
  return `${detail.value ? "Change" : "Add"} ${detail.label.toLowerCase()}`;
}

type LayoutProps = {
  account: Handler;
  you: Row[];
  about: Row[];
  data: ReactNode;
  danger: ReactNode;
  signout: ReactNode;
};

function Section({ title, note }: { title: string; note?: string }) {
  return (
    <div className="sect">
      <h2>{title}</h2>
      <span className="line" />
      {note && <span className="opt">{note}</span>}
    </div>
  );
}

/** Above the breakpoint: a label column, the value and its note beside it. */
function AccountDesktop({ account, you, about, data, danger, signout }: LayoutProps) {
  const rows = (list: Row[]) => (
    <div className="card">
      {list.map(({ detail, form, onEdit }) => (
        <div className="row" key={detail.field}>
          {form ?? (
            <>
              <span className="k">{detail.label}</span>
              <span className={detail.value ? `v${detail.mono ? " mono" : ""}` : "v empty"}>
                {detail.value ?? "Not set"}
                {detail.hint && <span className="sub">{detail.hint}</span>}
              </span>
              <button className="act" type="button" aria-label={change(detail)} onClick={onEdit}>
                {detail.value ? "Change" : "Add"}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="account" data-account="desktop">
      <Link className="back" to="/home">
        &larr; Home
      </Link>
      <div className="head">
        <div className="av">{initials(account.name)}</div>
        <div>
          <h1>Your account</h1>
          <div className="since">{since(account)}</div>
        </div>
      </div>

      <Section title="You" />
      {rows(you)}
      <Section title="About you" note="All optional" />
      {rows(about)}
      <Section title="Your data" />
      {data}
      <Section title="Delete account" />
      {danger}
      {signout}
    </div>
  );
}

/** Below it: the label above the value, the whole row a single column. */
function AccountMobile({ account, you, about, data, danger, signout }: LayoutProps) {
  const rows = (list: Row[]) => (
    <div className="card">
      {list.map(({ detail, form, onEdit }) => (
        <div className="row" key={detail.field}>
          {form ?? (
            <>
              <span className="mid">
                <span className="k">{detail.label}</span>
                <span className={detail.value ? `v${detail.mono ? " mono" : ""}` : "v empty"}>
                  {detail.value ?? "Not set"}
                </span>
                {detail.hint && <span className="sub">{detail.hint}</span>}
              </span>
              <button className="act" type="button" aria-label={change(detail)} onClick={onEdit}>
                {detail.value ? "Change" : "Add"}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="account" data-account="mobile">
      <div className="head">
        <div className="av">{initials(account.name)}</div>
        <div>
          <h1>Your account</h1>
          <div className="since">{since(account)}</div>
        </div>
      </div>

      <Section title="You" />
      {rows(you)}
      <Section title="About you" note="Optional" />
      {rows(about)}
      <Section title="Your data" />
      {data}
      <Section title="Delete account" />
      {danger}
      {signout}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

const since = (account: Handler) =>
  `Keeping records since ${formatDate(account.joined_on)} · ` +
  `${plural(account.pet_count, "pet", "pets")} · ` +
  `${plural(account.entry_count, "entry", "entries")}`;

export default function Account() {
  const [account, setAccount] = useState<Handler | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  const Layout = useIsDesktop() ? AccountDesktop : AccountMobile;

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    getMe()
      .then(setAccount)
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, []);

  if (!account) return null;

  const rowsFor = (list: Detail[]): Row[] =>
    list.map((detail) => ({
      detail,
      onEdit: () => setEditing(detail.field),
      form:
        editing === detail.field ? (
          <DetailForm
            detail={detail}
            onSaved={(saved) => {
              if (saved) setAccount(saved);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null,
    }));

  const data = (
    <div className="blk">
      <h3>Download everything</h3>
      <p>
        A single file with every pet, every entry and every photo, exactly as you entered them.
        Yours to keep, whatever happens to this account.
      </p>
      {/* A plain link: the API builds the archive on request and streams it,
          so the browser saves the file and nothing is held in memory here. */}
      <a className="btn" href={exportUrl()}>
        Download my data
      </a>
    </div>
  );

  const danger = (
    <div className="blk danger">
      <h3>Delete your account</h3>
      <p>This cannot be undone. Download your data first if you want to keep it.</p>
      <ul className="kills">
        <li>Your name, email address, date of birth, gender and nationality</li>
        <li>Your {plural(account.pet_count, "pet", "pets")}, archived ones included</li>
        <li>
          All {plural(account.entry_count, "entry", "entries")} and their notes, vets and due
          dates
        </li>
        <li>Every photo you have uploaded</li>
        <li>Every public page — links stop working immediately</li>
      </ul>
      {confirming ? (
        <span className="acts">
          <button
            className="btn warn"
            type="button"
            onClick={() =>
              deleteAccount().then(() => navigate("/signin", { replace: true }))
            }
          >
            Yes, delete everything
          </button>
          <button className="btn ghost" type="button" onClick={() => setConfirming(false)}>
            Keep my account
          </button>
        </span>
      ) : (
        <button className="btn warn" type="button" onClick={() => setConfirming(true)}>
          Delete my account
        </button>
      )}
    </div>
  );

  const signout = (
    <p className="out">
      <button
        type="button"
        onClick={() => signOut().then(() => navigate("/signin", { replace: true }))}
      >
        Sign out
      </button>
    </p>
  );

  return (
    <Shell name={account.name}>
      <Layout
        account={account}
        you={rowsFor(credentials(account))}
        about={rowsFor(aboutYou(account))}
        data={data}
        danger={danger}
        signout={signout}
      />
    </Shell>
  );
}
