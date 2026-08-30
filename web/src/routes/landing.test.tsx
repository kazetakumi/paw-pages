import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";

/** No cookie. At the root a 401 is the expected answer for a visitor, not a
 *  session that ran out, so nothing routes them to sign in. */
function signedOut() {
  server.use(
    http.get("http://localhost:8000/me", () => new HttpResponse(null, { status: 401 })),
  );
}

/** A cookie the API accepts, and the home screen behind it. */
function signedIn() {
  server.use(
    http.get("http://localhost:8000/me", () =>
      HttpResponse.json({ id: "h1", name: "Akhil", email: "akhil@example.com" }),
    ),
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
}

describe("the landing page", () => {
  it("shows a real pet record, not an illustration", async () => {
    signedOut();

    renderRoute("/");

    const record = await screen.findByRole("region", { name: "Pet record" });
    expect(within(record).getByText("Biscuit")).toBeInTheDocument();
    expect(within(record).getByText("Indian Pariah · male · 4 yrs")).toBeInTheDocument();
    expect(within(record).getByText("Rabies booster")).toBeInTheDocument();
    // Space Mono is the app's face for every date, and these are the app's
    // own dates, formatted by the same helper the pet's own page uses.
    expect(within(record).getByText("14 Jul 2026")).toHaveClass("date");
    expect(within(record).getByText("20 Apr 2026")).toHaveClass("date");
  });

  it("states that it sends no email and no notification", async () => {
    signedOut();

    renderRoute("/");

    expect(
      await screen.findByText(/Paw Pages sends no email and no notification\./),
    ).toBeInTheDocument();
  });

  it("routes a visitor into signup", async () => {
    signedOut();

    renderRoute("/");
    const links = await screen.findAllByRole("link", { name: "Create an account" });
    await userEvent.click(links[0]!);

    expect(
      await screen.findByRole("heading", { name: "Create your account" }),
    ).toBeInTheDocument();
  });

  it("routes a visitor into sign in", async () => {
    signedOut();

    renderRoute("/");
    const links = await screen.findAllByRole("link", { name: "Sign in" });
    await userEvent.click(links[0]!);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("sends a signed-in handler to their home screen without showing them the page", async () => {
    signedIn();

    const { container } = renderRoute("/");

    // Nothing at all until the API has said whether there is a session: the
    // landing page never flashes past on the way to the home screen.
    expect(container).toBeEmptyDOMElement();
    expect(await screen.findByRole("heading", { name: "Your pets" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pet record" })).toBeNull();
  });

  it("draws the desktop layout above the breakpoint", async () => {
    signedOut();
    setViewportWidth(1200);

    const { container } = renderRoute("/");

    await screen.findByRole("region", { name: "Pet record" });
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();
  });

  it("draws the mobile layout below the breakpoint", async () => {
    signedOut();
    setViewportWidth(390);

    const { container } = renderRoute("/");

    await screen.findByRole("region", { name: "Pet record" });
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
  });
});
