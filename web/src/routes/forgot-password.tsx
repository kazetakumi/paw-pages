import { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "../api";
import { AuthScreen } from "../auth/AuthScreen";

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setProblem(null);
    try {
      await requestPasswordReset(String(form.get("email")));
      setSent(true);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "Something went wrong.");
    }
  }

  return (
    <AuthScreen>
      <div className="sheet">
        <h1>Reset your password</h1>
        {sent ? (
          <>
            <p className="lede">
              If that address has an account, a link is on its way. It works once.
            </p>
            <p className="note">
              This is the only email we ever send. Check the spam folder if it isn&rsquo;t there.
            </p>
          </>
        ) : (
          <>
            <p className="lede">We&rsquo;ll email you a link to set a new one.</p>
            <form onSubmit={submit}>
              <div className="f">
                <div className="lab">
                  <label htmlFor="email">Email</label>
                </div>
                <div className="field">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>
              <button className="btn" type="submit">
                Email me a link
              </button>
            </form>
            {problem && (
              <p className="note bad" role="alert">
                {problem}
              </p>
            )}
          </>
        )}
      </div>

      <p className="alt">
        Remembered it? <Link to="/signin">Sign in</Link>
      </p>
    </AuthScreen>
  );
}
