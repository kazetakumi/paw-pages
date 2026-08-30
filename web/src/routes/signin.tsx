import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signIn } from "../api";

// Bare and unstyled on purpose: ticket 02 replaces this with the drawn screen.
export default function SignIn() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await signIn(String(form.get("email")), String(form.get("password")));
      navigate("/home");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required />
        <button type="submit">Sign in</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <Link to="/signup">Create an account</Link>
    </main>
  );
}
