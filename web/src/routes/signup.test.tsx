import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

async function fillTheForm() {
  await userEvent.type(screen.getByLabelText("Your name"), "Akhil");
  await userEvent.type(screen.getByLabelText("Email"), "akhil@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse");
}

describe("signing up", () => {
  it("draws the desktop layout above the breakpoint", () => {
    setViewportWidth(1200);

    const { container } = renderRoute("/signup");

    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();
  });

  it("draws the mobile layout below the breakpoint", () => {
    setViewportWidth(390);

    const { container } = renderRoute("/signup");

    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
  });

  it("says in plain words that the email is only ever used to reset a password", () => {
    renderRoute("/signup");

    expect(
      screen.getByText(/only ever email you to reset your password/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no reminders, no newsletters, no notifications/i)).toBeInTheDocument();
  });

  it("reveals the password and hides it again", async () => {
    renderRoute("/signup");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(password).toHaveAttribute("type", "text");

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("creates the account and lands on the greeting", async () => {
    server.use(
      http.post("http://localhost:8000/auth/signup", () => HttpResponse.json(me)),
      http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
      http.get("http://localhost:8000/pets", () => HttpResponse.json([])),
    );

    renderRoute("/signup");
    await fillTheForm();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Your pets" })).toBeInTheDocument();
  });

  it("puts an already-registered email beside the email field and points at sign in", async () => {
    server.use(
      http.post("http://localhost:8000/auth/signup", () =>
        HttpResponse.json(
          {
            detail: {
              field: "email",
              message: "That email already has an account. Sign in instead.",
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderRoute("/signup");
    await fillTheForm();
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    const email = screen.getByLabelText("Email");
    await waitFor(() => expect(email).toHaveAccessibleDescription(/sign in instead/i));
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin");
  });
});
