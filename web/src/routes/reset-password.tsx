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
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setProblem(null);
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
