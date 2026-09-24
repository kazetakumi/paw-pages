import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

describe("signing in", () => {
  it("draws the desktop layout above the breakpoint", () => {
    setViewportWidth(1200);

    const { container } = renderRoute("/signin");

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();
  });

  it("draws the mobile layout below the breakpoint", () => {
    setViewportWidth(390);

    const { container } = renderRoute("/signin");

    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
  });

  it("reveals the password and hides it again", async () => {
    renderRoute("/signin");
    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(password).toHaveAttribute("type", "text");

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("offers a way out to a handler who has forgotten their password", () => {
    renderRoute("/signin");

    expect(screen.getByRole("link", { name: /forgot/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("lands on the greeting, holding no token of its own", async () => {
    server.use(
      http.post("http://localhost:8000/auth/signin", () => HttpResponse.json(me)),
      http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
      http.get("http://localhost:8000/dashboard", () =>
        HttpResponse.json({
          ledger: [],
          pets: [],
          active_pets: 0,
          overdue: 0,
          due_within_30_days: 0,
          archived_pets: 0,
          archived: [],
        }),
      ),
    );

    renderRoute("/signin");
    await userEvent.type(screen.getByLabelText("Email"), "akhil@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByPlaceholderText("Ask Paw Pages, or log something new"),
    ).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("says so when the password is wrong, and stays on the screen", async () => {
    server.use(
      http.post("http://localhost:8000/auth/signin", () =>
        HttpResponse.json({ detail: "Email or password is wrong." }, { status: 401 }),
      ),
    );

    renderRoute("/signin");
    await userEvent.type(screen.getByLabelText("Email"), "akhil@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is wrong.");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
