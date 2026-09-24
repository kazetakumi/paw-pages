import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
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
  );
}

describe("the landing page", () => {
  it("pitches the chat-first record, not a form", async () => {
    signedOut();

    const { container } = renderRoute("/");

    expect(await screen.findByText("Tell it what happened.")).toBeInTheDocument();
    expect(container.querySelector("h1")).toHaveTextContent(
      "Tell it what happened.It keeps the record.",
    );
    // The hero's chat mock is the actual product, in miniature: a due date,
    // an overdue stamp, and a logged reply, same as the real /home screen.
    expect(screen.getByText("OVERDUE")).toBeInTheDocument();
    expect(screen.getByText("Biscuit had his deworming today — no issues.")).toBeInTheDocument();
  });

  it("states that it needs nothing but a chat message", async () => {
    signedOut();

    renderRoute("/");

    expect(
      await screen.findByText(/No emails\. No notifications\./),
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

  it("sends 'See an example' at the chat screen and 'Example pet page' at the public page", async () => {
    signedOut();

    renderRoute("/");

    expect(await screen.findByRole("link", { name: "See an example" })).toHaveAttribute(
      "href",
      "/home",
    );
    expect(screen.getByRole("link", { name: "Example pet page" })).toHaveAttribute(
      "href",
      "/p/biscuit-a4f2",
    );
  });

  it("sends a signed-in handler to their home screen without showing them the page", async () => {
    signedIn();

    const { container } = renderRoute("/");

    // Nothing at all until the API has said whether there is a session: the
    // landing page never flashes past on the way to the home screen.
    expect(container).toBeEmptyDOMElement();
    expect(
      await screen.findByPlaceholderText("Ask Paw Pages, or log something new"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Tell it what happened/)).toBeNull();
  });

  it("draws the desktop layout above the breakpoint", async () => {
    signedOut();
    setViewportWidth(1200);

    const { container } = renderRoute("/");

    await screen.findByText("Tell it what happened.");
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();
  });

  it("draws the mobile layout below the breakpoint", async () => {
    signedOut();
    setViewportWidth(390);

    const { container } = renderRoute("/");

    await screen.findByText("Tell it what happened.");
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
  });
});
