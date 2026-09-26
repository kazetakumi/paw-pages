import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";
import type { Handler } from "../api";

const akhil: Handler = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Akhil",
  email: "akhil@example.com",
  joined_on: "2025-07-02",
  pet_count: 3,
  entry_count: 47,
  credits: 63,
  date_of_birth: null,
  gender: null,
  nationality: null,
  age: null,
};

function signedInAs(handler: Handler) {
  server.use(
    http.get("http://localhost:8000/me", () => HttpResponse.json(handler)),
    http.get("http://localhost:8000/conversations", () => HttpResponse.json([])),
  );
}

const sse = (...events: object[]) =>
  new HttpResponse(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

describe("credits on the chat screen", () => {
  it("shows the balance in the sidebar and moves it after a turn", async () => {
    signedInAs(akhil);
    setViewportWidth(1200);
    server.use(
      http.post("http://localhost:8000/conversations/messages", () =>
        sse(
          { type: "conversation", id: "c1" },
          { type: "text.delta", text: "Logged." },
          { type: "done", text: "Logged.", credits: 55 },
        ),
      ),
    );

    renderRoute("/home");

    expect(await screen.findByText(/^63 credits/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(/ask paw pages/i), "Biscuit had a bath{Enter}");
    expect(await screen.findByText(/^55 credits/)).toBeInTheDocument();
  });

  it("blocks the composer when the day's credits are used up", async () => {
    signedInAs({ ...akhil, credits: 0 });
    setViewportWidth(1200);

    renderRoute("/home");

    expect(await screen.findByText(/used today’s credits/i)).toHaveTextContent(/come back tomorrow/i);
    expect(screen.getByPlaceholderText(/ask paw pages/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("keeps the typed message when the API says the credits ran out", async () => {
    signedInAs(akhil);
    setViewportWidth(1200);
    server.use(
      http.post("http://localhost:8000/conversations/messages", () =>
        HttpResponse.json({ detail: "out of credits" }, { status: 402 }),
      ),
    );

    renderRoute("/home");

    const box = await screen.findByPlaceholderText(/ask paw pages/i);
    await userEvent.type(box, "Biscuit had a bath{Enter}");

    expect(await screen.findByText(/used today’s credits/i)).toBeInTheDocument();
    expect(box).toHaveValue("Biscuit had a bath");
    expect(screen.queryByText("Biscuit had a bath", { selector: ".user-bubble" })).toBeNull();
  });
});
