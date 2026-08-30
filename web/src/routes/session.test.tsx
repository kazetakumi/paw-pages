import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { renderRoute } from "../test/render";

describe("a session that has run out", () => {
  it("sends the handler to sign in, wherever in the app the 401 came from", async () => {
    server.use(http.get("http://localhost:8000/me", () => new HttpResponse(null, { status: 401 })));

    renderRoute("/home");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
