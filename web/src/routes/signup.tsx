import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUp } from "../api";

// Bare and unstyled on purpose: ticket 02 replaces this with the drawn screen.
export default function SignUp() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await signUp(
        String(form.get("name")),
        String(form.get("email")),
        String(form.get("password")),
      );
      navigate("/home");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Something went wrong.");
    }
  }

  return (
    <main>
      <h1>Create an account</h1>
      <form onSubmit={submit}>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" required />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required />
        <button type="submit">Create account</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <Link to="/signin">I already have an account</Link>
    </main>
  );
}
