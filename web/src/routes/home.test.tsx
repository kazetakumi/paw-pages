import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

describe("the signed-in shell", () => {
  it("greets the handler by name in the desktop layout above the breakpoint", async () => {
    server.use(http.get("http://localhost:8000/me", () => HttpResponse.json(me)));
    setViewportWidth(1200);

    renderRoute("/home");

    expect(await screen.findByRole("heading", { name: "Hello, Akhil" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /main/i })).toBeInTheDocument();
    expect(screen.getByText("Akhil")).toBeInTheDocument();
  });

  it("greets the handler by name in the mobile layout below the breakpoint", async () => {
    server.use(http.get("http://localhost:8000/me", () => HttpResponse.json(me)));
    setViewportWidth(390);

    renderRoute("/home");

    expect(await screen.findByRole("heading", { name: "Hello, Akhil" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /account/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /main/i })).not.toBeInTheDocument();
  });

  it("sends the visitor to sign in when the API says they are not signed in", async () => {
    server.use(http.get("http://localhost:8000/me", () => new HttpResponse(null, { status: 401 })));

    renderRoute("/home");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
