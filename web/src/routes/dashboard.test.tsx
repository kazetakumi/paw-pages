import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";
import type { ArchivedPet, Dashboard, DueItem, PetCard } from "../api";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

const biscuit: PetCard = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Biscuit",
  species: "dog",
  breed: "Indian Pariah",
  sex: "male",
  date_of_birth: "2022-03-12",
  dob_is_approx: true,
  colour: "Tan & white",
  slug: "biscuit-a4f2",
  is_public: false,
  has_photo: false,
  age_years: 4,
  age_months: 5,
  next_due_on: "2026-07-14",
  next_due_is_overdue: true,
  last_logged_on: "2026-08-12",
};

const momo: PetCard = {
  id: "33333333-3333-3333-3333-333333333333",
  name: "Momo",
  species: "Persian cat",
  breed: null,
  sex: null,
  date_of_birth: null,
  dob_is_approx: false,
  colour: null,
  slug: "momo-9k2p",
  is_public: false,
  has_photo: false,
  age_years: null,
  age_months: null,
  next_due_on: null,
  next_due_is_overdue: false,
  last_logged_on: null,
};

// The API decides overdue and the day count; the fixtures only carry what it
// said, so nothing here can quietly agree with a screen that worked it out.
const rabies: DueItem = {
  entry_id: "d1",
  pet_id: biscuit.id,
  pet_name: "Biscuit",
  title: "Rabies booster",
  due_on: "2026-07-14",
  days_until: -46,
  is_overdue: true,
  happened_on: "2025-07-14",
  vet: "Anvayaa Clinic",
};

const deworming: DueItem = {
  entry_id: "d2",
  pet_id: momo.id,
  pet_name: "Momo",
  title: "Deworming",
  due_on: "2026-09-05",
  days_until: 7,
  is_overdue: false,
  happened_on: "2026-06-05",
  vet: null,
};

const dhpp: DueItem = {
  entry_id: "d3",
  pet_id: biscuit.id,
  pet_name: "Biscuit",
  title: "DHPP booster",
  due_on: "2026-09-21",
  days_until: 23,
  is_overdue: false,
  happened_on: "2023-09-21",
  vet: null,
};

const toffee: ArchivedPet = {
  id: "44444444-4444-4444-4444-444444444444",
  name: "Toffee",
  archived_reason: "passed_away",
  archived_on: "2026-06-02",
};

const marmalade: ArchivedPet = {
  id: "55555555-5555-5555-5555-555555555555",
  name: "Marmalade",
  archived_reason: "rehomed",
  archived_on: "2026-01-14",
};

const empty: Dashboard = {
  ledger: [],
  pets: [],
  active_pets: 0,
  overdue: 0,
  due_within_30_days: 0,
  archived_pets: 0,
  archived: [],
};

/** One request answers the whole screen — the stub counts how many it took. */
function signedInWith(board: Partial<Dashboard>) {
  const calls: string[] = [];
  server.use(
    http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
    http.get("http://localhost:8000/dashboard", () => {
      calls.push("/dashboard");
      return HttpResponse.json({ ...empty, ...board });
    }),
    // The sidebar's conversation list -- irrelevant to this screen, empty is fine.
    http.get("http://localhost:8000/conversations", () => HttpResponse.json([])),
  );
  return calls;
}

const ledgerRows = () =>
  within(screen.getByRole("region", { name: "Due and overdue" })).getAllByRole("link");

// Scoped to the page's own content, once it has loaded, rather than the
// whole screen -- the sidebar has its own links and shouldn't be in scope.
async function dash(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector(".dashboard")).toBeInTheDocument());
  return within(container.querySelector(".dashboard") as HTMLElement);
}

describe("the dashboard", () => {
  it("lists the handler's pets as cards in the desktop layout above the breakpoint", async () => {
    signedInWith({ pets: [biscuit, momo], active_pets: 2 });
    setViewportWidth(1200);

    const { container } = renderRoute("/dashboard");
    const page = await dash(container);

    expect(container.querySelector('.pets[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('.pets[data-layout="mobile"]')).toBeNull();

    const card = page.getByRole("link", { name: /Biscuit/ });
    expect(card).toHaveAttribute("href", `/pets/${biscuit.id}`);
    expect(within(card).getByText(/Indian Pariah/)).toHaveTextContent("male");
    expect(within(card).getByText(/Indian Pariah/)).toHaveTextContent("4 yrs 5 mo");
    expect(page.getByRole("link", { name: /Momo/ })).toBeInTheDocument();
    // Two ways in, as the drawing has them: the header button and the card at
    // the end of the grid. Both go to the same place.
    const addPet = page.getAllByRole("link", { name: /add a pet/i });
    expect(addPet).toHaveLength(2);
    for (const link of addPet) expect(link).toHaveAttribute("href", "/home?new=1");
  });

  it("lists the same pets stacked below the breakpoint", async () => {
    signedInWith({ pets: [biscuit, momo], active_pets: 2 });
    setViewportWidth(390);

    const { container } = renderRoute("/dashboard");
    const page = await dash(container);

    expect(container.querySelector('.pets[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('.pets[data-layout="desktop"]')).toBeNull();
    expect(page.getByRole("link", { name: /Biscuit/ })).toBeInTheDocument();
    expect(page.getByRole("link", { name: /Momo/ })).toBeInTheDocument();
    expect(page.getAllByRole("link", { name: /add a pet/i })).toHaveLength(2);
  });

  it("gives a pet with no photo an initial-letter avatar", async () => {
    signedInWith({ pets: [biscuit, momo] });

    const { container } = renderRoute("/dashboard");
    const page = await dash(container);

    const card = page.getByRole("link", { name: /Biscuit/ });

    expect(within(card).getByText("B")).toBeInTheDocument();
    expect(within(page.getByRole("link", { name: /Momo/ })).getByText("M")).toBeInTheDocument();
  });

  it("shows only what a pet actually has", async () => {
    signedInWith({ pets: [momo] });

    const { container } = renderRoute("/dashboard");
    const page = await dash(container);

    const card = page.getByRole("link", { name: /Momo/ });

    expect(within(card).getByText("Persian cat")).toBeInTheDocument();
  });

  it("invites a handler with no pets to add one", async () => {
    signedInWith({});

    const { container } = renderRoute("/dashboard");
    const page = await dash(container);

    expect(page.getAllByRole("link", { name: /add a pet/i })[0]).toBeInTheDocument();
    expect(page.queryByRole("link", { name: /Biscuit/ })).not.toBeInTheDocument();
  });

  it("opens with the ledger, oldest problem first, across every pet", async () => {
    signedInWith({ ledger: [rabies, deworming, dhpp], pets: [biscuit, momo] });
    setViewportWidth(1200);

    renderRoute("/dashboard");

    await screen.findByRole("region", { name: "Due and overdue" });
    const rows = ledgerRows();

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Biscuit");
    expect(rows[0]).toHaveTextContent("Rabies booster");
    expect(rows[1]).toHaveTextContent("Momo");
    expect(rows[1]).toHaveTextContent("Deworming");
    expect(rows[2]).toHaveTextContent("DHPP booster");
    expect(rows[0]).toHaveAttribute("href", `/pets/${biscuit.id}`);
    expect(rows[0]!.closest("[data-layout]")).toHaveAttribute("data-layout", "desktop");
  });

  it("stamps the overdue item with how many days it is overdue, and nothing else", async () => {
    signedInWith({ ledger: [rabies, deworming, dhpp], pets: [biscuit, momo] });
    setViewportWidth(1200);

    renderRoute("/dashboard");

    await screen.findByRole("region", { name: "Due and overdue" });
    const rows = ledgerRows();

    expect(rows[0]).toHaveTextContent("Overdue 46 days");
    expect(rows[1]).toHaveTextContent("In 7 days");
    expect(rows[1]).not.toHaveTextContent(/overdue/i);
    expect(rows[2]).toHaveTextContent("In 23 days");
    expect(rows[2]).not.toHaveTextContent(/overdue/i);
  });

  it("draws the ledger in the mobile layout below the breakpoint", async () => {
    signedInWith({ ledger: [rabies, deworming], pets: [biscuit, momo] });
    setViewportWidth(390);

    renderRoute("/dashboard");

    await screen.findByRole("region", { name: "Due and overdue" });
    const rows = ledgerRows();

    expect(rows[0]!.closest("[data-layout]")).toHaveAttribute("data-layout", "mobile");
    expect(rows[0]).toHaveTextContent("Overdue 46d");
    expect(rows[1]).toHaveTextContent("In 7 days");
  });

  it("shows active pets, overdue items and what is due within thirty days", async () => {
    signedInWith({
      ledger: [rabies, deworming, dhpp],
      pets: [biscuit, momo],
      active_pets: 3,
      overdue: 1,
      due_within_30_days: 2,
    });

    const { container } = renderRoute("/dashboard");
    await dash(container);
    const tally = container.querySelector(".tally");

    expect(tally).toHaveTextContent("3 ACTIVE");
    expect(tally).toHaveTextContent("1 OVERDUE");
    expect(tally).toHaveTextContent("2 DUE WITHIN 30 DAYS");
  });

  it("closes each pet card with its next due and its last logged date", async () => {
    signedInWith({ pets: [biscuit, momo] });
    setViewportWidth(1200);

    const { container } = renderRoute("/dashboard");
    const page = await dash(container);

    const card = page.getByRole("link", { name: /Biscuit/ });

    expect(within(card).getByText("14 Jul 2026")).toBeInTheDocument();
    expect(within(card).getByText("12 Aug 2026")).toBeInTheDocument();

    const bare = page.getByRole("link", { name: /Momo/ });

    expect(within(bare).getByText("Nothing due")).toBeInTheDocument();
    expect(within(bare).getByText("Nothing yet")).toBeInTheDocument();
  });

  it("names one archived pet with a link to its own record", async () => {
    signedInWith({ pets: [biscuit], archived_pets: 1, archived: [toffee] });

    renderRoute("/dashboard");

    expect(await screen.findByText("1 archived pet")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Toffee" });
    expect(link).toHaveAttribute("href", `/pets/${toffee.id}`);
  });

  it("names several archived pets, each one its own link", async () => {
    signedInWith({ pets: [biscuit], archived_pets: 2, archived: [toffee, marmalade] });

    renderRoute("/dashboard");

    expect(await screen.findByText("2 archived pets")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Toffee" })).toHaveAttribute(
      "href",
      `/pets/${toffee.id}`,
    );
    expect(screen.getByRole("link", { name: "Marmalade" })).toHaveAttribute(
      "href",
      `/pets/${marmalade.id}`,
    );
  });

  it("says nothing about archived pets when there are none", async () => {
    signedInWith({ pets: [biscuit] });

    const { container } = renderRoute("/dashboard");
    await dash(container);

    expect(screen.queryByText(/archived/)).not.toBeInTheDocument();
  });

  it("asks for the ledger, the cards and the counts once", async () => {
    const calls = signedInWith({ ledger: [rabies], pets: [biscuit], overdue: 1 });

    renderRoute("/dashboard");

    await screen.findByRole("region", { name: "Due and overdue" });

    expect(calls).toEqual(["/dashboard"]);
  });

  it("says nothing about due dates when nothing is outstanding", async () => {
    signedInWith({ pets: [momo] });

    const { container } = renderRoute("/dashboard");
    await dash(container);

    expect(screen.queryByRole("region", { name: "Due and overdue" })).not.toBeInTheDocument();
  });
});

describe("a pet card's portrait", () => {
  it("shows the photo from our own API, and the letter for a pet without one", async () => {
    signedInWith({ pets: [{ ...biscuit, has_photo: true }, momo], active_pets: 2 });

    const { container } = renderRoute("/dashboard");

    expect(await screen.findByRole("img", { name: "Biscuit" })).toHaveAttribute(
      "src",
      `http://localhost:8000/pets/${biscuit.id}/photo`,
    );
    expect(screen.queryByRole("img", { name: "Momo" })).not.toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/supabase/i);
  });
});
