import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { renderRoute } from "../test/render";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

describe("signing in", () => {
  it("lands on the greeting, holding no token of its own", async () => {
    server.use(
      http.post("http://localhost:8000/auth/signin", () => HttpResponse.json(me)),
      http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
    );

    renderRoute("/signin");
    await userEvent.type(screen.getByLabelText("Email"), "akhil@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Hello, Akhil" })).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});
