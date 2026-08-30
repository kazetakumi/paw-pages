import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { renderRoute } from "../test/render";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

describe("signing up", () => {
  it("creates the account and lands on the greeting", async () => {
    server.use(
      http.post("http://localhost:8000/auth/signup", () => HttpResponse.json(me)),
      http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
    );

    renderRoute("/signup");
    await userEvent.type(screen.getByLabelText("Name"), "Akhil");
    await userEvent.type(screen.getByLabelText("Email"), "akhil@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Hello, Akhil" })).toBeInTheDocument();
  });

  it("shows the API's message when the email is already registered", async () => {
    server.use(
      http.post("http://localhost:8000/auth/signup", () =>
        HttpResponse.json({ detail: "User already registered" }, { status: 400 }),
      ),
    );

    renderRoute("/signup");
    await userEvent.type(screen.getByLabelText("Name"), "Akhil");
    await userEvent.type(screen.getByLabelText("Email"), "akhil@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("User already registered");
  });
});
