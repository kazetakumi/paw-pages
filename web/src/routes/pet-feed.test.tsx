import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";
import type { Entry, Pet } from "../api";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

const biscuit: Pet = {
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

const entry = (fields: Partial<Entry> & { id: string; title: string; happened_on: string }): Entry => ({
  pet_id: biscuit.id,
  due_on: null,
  vet: null,
  note: null,
  is_overdue: false,
  ...fields,
});

const deworming = entry({
  id: "a1",
  title: "Deworming",
  happened_on: "2026-08-12",
  note: "Half tablet, took it in cheese.",
  due_on: "2026-11-12",
});

const vetVisit = entry({
  id: "a2",
  title: "Vet visit",
  happened_on: "2026-06-02",
  note: "Limping on the back right leg.",
  vet: "Dr. Menon",
});

const rabies = entry({
  id: "a3",
  title: "Rabies booster",
  happened_on: "2025-07-14",
  vet: "Anvayaa Clinic",
  due_on: "2026-07-14",
  is_overdue: true,
});

const feed = `/pets/${biscuit.id}`;

function signedInWith(pages: { entries: Entry[]; next_cursor: string | null }[]) {
  const asked: (string | null)[] = [];
  server.use(
    http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
    http.get(`http://localhost:8000/pets/${biscuit.id}`, () => HttpResponse.json(biscuit)),
    // The stub keys off the cursor it was handed, so a screen that dropped one
    // or invented one would get the wrong page rather than the next.
    http.get(`http://localhost:8000/pets/${biscuit.id}/entries`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      asked.push(cursor);
      const page = pages.find((_, index) =>
        index === 0 ? cursor === null : pages[index - 1]!.next_cursor === cursor,
      );
      return page ? HttpResponse.json(page) : new HttpResponse(null, { status: 400 });
    }),
  );
  return asked;
}

describe("a pet's feed", () => {
  it("shows the record newest first in the desktop layout above the breakpoint", async () => {
    signedInWith([{ entries: [deworming, vetVisit, rabies], next_cursor: null }]);
    setViewportWidth(1200);

    const { container } = renderRoute(feed);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();

    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Deworming", "Vet visit", "Rabies booster"]);
  });

  it("shows the same record in the mobile layout below the breakpoint", async () => {
    signedInWith([{ entries: [deworming, vetVisit, rabies], next_cursor: null }]);
    setViewportWidth(390);

    const { container } = renderRoute(feed);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Deworming",
      "Vet visit",
      "Rabies booster",
    ]);
  });

  it("shows each entry's date, title, note, vet and next due", async () => {
    signedInWith([{ entries: [deworming, vetVisit, rabies], next_cursor: null }]);

    renderRoute(feed);

    const first = (await screen.findByRole("heading", { name: "Deworming" })).closest("article")!;
    expect(within(first).getByText("12 Aug 2026")).toBeInTheDocument();
    expect(within(first).getByText("Half tablet, took it in cheese.")).toBeInTheDocument();
    expect(within(first).getByText(/Next due 12 Nov 2026/)).toBeInTheDocument();

    const second = screen.getByRole("heading", { name: "Vet visit" }).closest("article")!;
    expect(within(second).getByText("Dr. Menon")).toBeInTheDocument();
    expect(within(second).queryByText(/Next due/)).toBeNull();
  });

  it("marks an entry overdue only when the API said it was", async () => {
    signedInWith([{ entries: [deworming, rabies], next_cursor: null }]);

    renderRoute(feed);

    const stale = (await screen.findByRole("heading", { name: "Rabies booster" })).closest("article")!;
    expect(within(stale).getByText(/overdue/i)).toBeInTheDocument();

    const fine = screen.getByRole("heading", { name: "Deworming" }).closest("article")!;
    expect(within(fine).queryByText(/overdue/i)).toBeNull();
  });

  it("offers the About tab and a way to log an entry against this pet", async () => {
    signedInWith([{ entries: [deworming], next_cursor: null }]);

    renderRoute(feed);

    expect(await screen.findByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      `/pets/${biscuit.id}/about`,
    );
    expect(screen.getByRole("link", { name: /log an entry/i })).toHaveAttribute(
      "href",
      `/log?pet=${biscuit.id}`,
    );
  });

  it("keeps older entries behind a control and pages them in by cursor", async () => {
    const asked = signedInWith([
      { entries: [deworming], next_cursor: "b3BhcXVl" },
      { entries: [vetVisit, rabies], next_cursor: null },
    ]);

    renderRoute(feed);

    expect(await screen.findByRole("heading", { name: "Deworming" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Vet visit" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /older/i }));

    expect(await screen.findByRole("heading", { name: "Vet visit" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Deworming",
      "Vet visit",
      "Rabies booster",
    ]);
    expect(asked).toEqual([null, "b3BhcXVl"]);
    expect(screen.queryByRole("button", { name: /older/i })).toBeNull();
  });

  it("offers nothing to expand when the whole record already fits", async () => {
    signedInWith([{ entries: [deworming, vetVisit], next_cursor: null }]);

    renderRoute(feed);

    expect(await screen.findByRole("heading", { name: "Deworming" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /older/i })).toBeNull();
  });
});
