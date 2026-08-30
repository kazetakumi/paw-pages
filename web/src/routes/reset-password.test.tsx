import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";

// Supabase Auth sends the handler back with the recovery token in the fragment.
const LINK = "/reset-password#access_token=emailed-token&type=recovery";

describe("resetting a password", () => {
  it("draws the desktop layout above the breakpoint", () => {
    setViewportWidth(1200);

    const { container } = renderRoute(LINK);

    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();
  });

  it("draws the mobile layout below the breakpoint", () => {
    setViewportWidth(390);

    const { container } = renderRoute(LINK);

    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
  });

  it("spends the token from the link and sends the handler on to sign in", async () => {
    const confirmed: unknown[] = [];
    server.use(
      http.post("http://localhost:8000/auth/password-reset/confirm", async ({ request }) => {
        confirmed.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderRoute(LINK);
    await userEvent.type(screen.getByLabelText("New password"), "a whole new horse");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin",
    );
    expect(confirmed).toEqual([
      { access_token: "emailed-token", password: "a whole new horse" },
    ]);
  });

  it("tells a handler whose link has expired to ask for another", async () => {
    server.use(
      http.post("http://localhost:8000/auth/password-reset/confirm", () =>
        HttpResponse.json(
          { detail: "That reset link has expired. Request a new one." },
          { status: 400 },
        ),
      ),
    );

    renderRoute(LINK);
    await userEvent.type(screen.getByLabelText("New password"), "a whole new horse");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("expired");
    expect(screen.getByRole("link", { name: /ask for a new link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("sends a handler who arrives without a token back to ask for a link", () => {
    renderRoute("/reset-password");

    expect(screen.getByRole("link", { name: /ask for a new link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByLabelText("New password")).toBeNull();
  });
});
