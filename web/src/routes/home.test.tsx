import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

const biscuit = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Biscuit",
  species: "dog",
  breed: "Indian Pariah",
  sex: "male",
  date_of_birth: "2022-03-12",
  dob_is_approx: true,
  colour: "Tan & white",
  slug: "biscuit-a4f2",
  age_years: 4,
  age_months: 5,
};

const momo = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Momo",
  species: "Persian cat",
  breed: null,
  sex: null,
  date_of_birth: null,
  dob_is_approx: false,
  colour: null,
  slug: "momo-9k2p",
  age_years: null,
  age_months: null,
};

function signedInWith(pets: unknown[]) {
  server.use(
    http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
    http.get("http://localhost:8000/pets", () => HttpResponse.json(pets)),
  );
}

describe("the home screen", () => {
  it("lists the handler's pets as cards in the desktop layout above the breakpoint", async () => {
    signedInWith([biscuit, momo]);
    setViewportWidth(1200);

    const { container } = renderRoute("/home");

    expect(await screen.findByRole("heading", { name: "Your pets" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();

    const card = screen.getByRole("link", { name: /Biscuit/ });
    expect(card).toHaveAttribute("href", `/pets/${biscuit.id}`);
    expect(within(card).getByText(/Indian Pariah/)).toHaveTextContent("male");
    expect(within(card).getByText(/Indian Pariah/)).toHaveTextContent("4 yrs 5 mo");
    expect(screen.getByRole("link", { name: /Momo/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add a pet/i })).toHaveAttribute("href", "/pets/new");
  });

  it("lists the same pets in the mobile layout below the breakpoint", async () => {
    signedInWith([biscuit, momo]);
    setViewportWidth(390);

    const { container } = renderRoute("/home");

    expect(await screen.findByRole("heading", { name: "Your pets" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
    expect(screen.getByRole("link", { name: /Biscuit/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Momo/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add a pet/i })).toBeInTheDocument();
  });

  it("gives a pet with no photo an initial-letter avatar", async () => {
    signedInWith([biscuit, momo]);

    renderRoute("/home");

    const card = await screen.findByRole("link", { name: /Biscuit/ });

    expect(within(card).getByText("B")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Momo/ })).getByText("M")).toBeInTheDocument();
  });

  it("shows only what a pet actually has", async () => {
    signedInWith([momo]);

    renderRoute("/home");

    const card = await screen.findByRole("link", { name: /Momo/ });

    expect(within(card).getByText("Persian cat")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("·");
  });

  it("invites a handler with no pets to add one", async () => {
    signedInWith([]);

    renderRoute("/home");

    expect(await screen.findByRole("link", { name: /add a pet/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Biscuit/ })).not.toBeInTheDocument();
  });
});
