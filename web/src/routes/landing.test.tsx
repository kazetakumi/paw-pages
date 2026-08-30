import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { renderRoute } from "../test/render";

/** No cookie. At the root a 401 is the expected answer for a visitor, not a
 *  session that ran out, so nothing routes them to sign in. */
function signedOut() {
  server.use(
    http.get("http://localhost:8000/me", () => new HttpResponse(null, { status: 401 })),
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
});
