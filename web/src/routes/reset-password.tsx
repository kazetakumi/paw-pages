import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { confirmPasswordReset } from "../api";
import { AuthScreen } from "../auth/AuthScreen";
import { PasswordField } from "../auth/PasswordField";

function AskAgain({ children }: { children: React.ReactNode }) {
  return (
    <AuthScreen>
      <div className="sheet">
        <h1>Choose a new password</h1>
        {children}
      </div>
      <p className="alt">
        <Link to="/forgot-password">Ask for a new link</Link>
      </p>
    </AuthScreen>
  );
}

export default function ResetPassword() {
  // Supabase Auth hands the recovery token back in the fragment. It goes
  // straight through to our API, is spent once, and is never a session.
  const token = new URLSearchParams(useLocation().hash.slice(1)).get("access_token");
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMismatch(null);
    setProblem(null);
    // The second field never leaves the browser; it exists to catch a typo in
    // a password the handler is setting blind.
    if (String(form.get("password")) !== String(form.get("confirm"))) {
      setMismatch("Those passwords do not match.");
      return;
    }
    try {
      await confirmPasswordReset(token!, String(form.get("password")));
      setDone(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "Something went wrong.");
    }
  }

  if (!token) {
    return (
      <AskAgain>
        <p className="lede">
          That link is missing its token, so it can&rsquo;t set a password. Reset links work once
          and then expire.
        </p>
      </AskAgain>
    );
  }

  if (done) {
    return (
      <AuthScreen>
        <div className="sheet">
          <h1>Choose a new password</h1>
          <p className="lede">Done. Sign in with your new password.</p>
        </div>
        <p className="alt">
          <Link to="/signin">Sign in</Link>
        </p>
      </AuthScreen>
    );
  }

  return (
    <AskAgain>
      <p className="lede">Then sign in with it. This link works once.</p>
      <form onSubmit={submit}>
        <PasswordField
          id="password"
          label="New password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          minLength={8}
        />
        <PasswordField
          id="confirm"
          label="Confirm new password"
          placeholder="Type it again"
          autoComplete="new-password"
          minLength={8}
          problem={mismatch}
        />
        <button className="btn" type="submit">
          Set new password
        </button>
      </form>
      {problem && (
        <p className="note bad" role="alert">
          {problem}
        </p>
      )}
    </AskAgain>
  );
}
