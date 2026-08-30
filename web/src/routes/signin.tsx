import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signIn } from "../api";
import { AuthScreen } from "../auth/AuthScreen";
import { PasswordField } from "../auth/PasswordField";

export default function SignIn() {
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setProblem(null);
    try {
      await signIn(String(form.get("email")), String(form.get("password")));
      navigate("/home");
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : "Something went wrong.");
    }
  }

  return (
    <AuthScreen>
      <div className="sheet">
        <h1>Sign in</h1>
        <p className="lede">Welcome back.</p>

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

          <PasswordField
            id="password"
            label="Password"
            placeholder="Your password"
            autoComplete="current-password"
            aux={
              <Link className="aux" to="/forgot-password">
                Forgot?
              </Link>
            }
          />

          <button className="btn" type="submit">
            Sign in
          </button>
        </form>

        {problem && (
          <p className="note bad" role="alert">
            {problem}
          </p>
        )}
      </div>

      <p className="alt">
        New here? <Link to="/signup">Create an account</Link>
      </p>
    </AuthScreen>
  );
}
