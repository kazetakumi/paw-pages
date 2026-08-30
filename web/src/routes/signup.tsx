import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FieldError, signUp } from "../api";
import { AuthScreen } from "../auth/AuthScreen";
import { PasswordField } from "../auth/PasswordField";

export default function SignUp() {
  const navigate = useNavigate();
  const [emailProblem, setEmailProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setEmailProblem(null);
    setProblem(null);
    try {
      await signUp(
        String(form.get("name")),
        String(form.get("email")),
        String(form.get("password")),
      );
      navigate("/home");
    } catch (failure) {
      if (failure instanceof FieldError && failure.field === "email") {
        setEmailProblem(failure.message);
      } else {
        setProblem(failure instanceof Error ? failure.message : "Something went wrong.");
      }
    }
  }

  return (
    <AuthScreen>
      <div className="sheet">
        <h1>Create your account</h1>
        <p className="lede">One account, as many pets as you keep.</p>

        <form onSubmit={submit}>
          <div className="f">
            <div className="lab">
              <label htmlFor="name">Your name</label>
            </div>
            <div className="field">
              <input id="name" name="name" type="text" placeholder="Akhil" autoComplete="name" required />
            </div>
          </div>

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
                aria-invalid={emailProblem ? true : undefined}
                aria-describedby={emailProblem ? "email-hint email-problem" : "email-hint"}
              />
            </div>
            <p className="hint" id="email-hint">
              You&rsquo;ll sign in with this. It&rsquo;s the only way to get back in if you forget
              your password.
            </p>
            {emailProblem && (
              <p className="problem" id="email-problem">
                {emailProblem}
              </p>
            )}
          </div>

          <PasswordField
            id="password"
            label="Password"
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
          />

          <button className="btn" type="submit">
            Create account
          </button>
        </form>

        <p className="note">
          We only ever email you to reset your password.
          <br />
          No reminders, no newsletters, no notifications.
        </p>
        {problem && (
          <p className="note bad" role="alert">
            {problem}
          </p>
        )}
      </div>

      <p className="alt">
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </AuthScreen>
  );
}
