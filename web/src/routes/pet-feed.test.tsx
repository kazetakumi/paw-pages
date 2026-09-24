import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";
import type { DueItem, Entry, PetRecord } from "../api";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

const biscuit: PetRecord = {
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
  due_items: [],
};

const entry = (fields: Partial<Entry> & { id: string; title: string; happened_on: string }): Entry => ({
  pet_id: biscuit.id,
  due_on: null,
  vet: null,
  note: null,
  weight_value: null,
  weight_unit: null,
  has_photo: false,
  photo_is_public: false,
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

/** The outstanding item behind the rabies entry, as `due_items` returns it. */
const outstanding: DueItem = {
  entry_id: rabies.id,
  pet_id: biscuit.id,
  pet_name: "Biscuit",
  title: "Rabies booster",
  due_on: "2026-07-14",
  days_until: -46,
  is_overdue: true,
  happened_on: "2025-07-14",
  vet: "Anvayaa Clinic",
};

const feed = `/pets/${biscuit.id}`;

function signedInWith(
  pages: { entries: Entry[]; next_cursor: string | null }[],
  dueItems: DueItem[] = [],
) {
  const asked: (string | null)[] = [];
  server.use(
    http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
    http.get(`http://localhost:8000/pets/${biscuit.id}`, () =>
      HttpResponse.json({ ...biscuit, due_items: dueItems }),
    ),
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
  it("shows the header, tabs and a way to chat about this pet", async () => {
    signedInWith([{ entries: [], next_cursor: null }]);

    renderRoute(feed);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(screen.getByText(/Indian Pariah/)).toHaveTextContent("male");
    expect(screen.getByRole("link", { name: "Chat about Biscuit" })).toHaveAttribute(
      "href",
      "/home?new=1",
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      `/pets/${biscuit.id}/about`,
    );
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute("href", "/dashboard");
  });

  it("shows the record newest first in the desktop layout above the breakpoint", async () => {
    signedInWith([{ entries: [deworming, vetVisit, rabies], next_cursor: null }]);
    setViewportWidth(1200);

    const { container } = renderRoute(feed);

    await screen.findByRole("heading", { name: "Biscuit" });
    // Desktop stacks the year under the day, in its own element.
    expect(container.querySelector(".ent .yr")).toBeInTheDocument();
    expect(container.querySelectorAll(".ent .ttl").length).toBe(3);
    const titles = [...container.querySelectorAll(".ent .ttl")].map((el) => el.textContent);
    expect(titles).toEqual(["Deworming", "Vet visit", "Rabies booster"]);
  });

  it("shows the same record in the mobile layout below the breakpoint, on one date line", async () => {
    signedInWith([{ entries: [deworming, vetVisit, rabies], next_cursor: null }]);
    setViewportWidth(390);

    const { container } = renderRoute(feed);

    await screen.findByRole("heading", { name: "Biscuit" });
    expect(container.querySelector(".ent .yr")).toBeNull();
    expect(screen.getByText("12 Aug 2026")).toBeInTheDocument();
    const titles = [...container.querySelectorAll(".ent .ttl")].map((el) => el.textContent);
    expect(titles).toEqual(["Deworming", "Vet visit", "Rabies booster"]);
  });

  it("shows each entry's date, title, note, vet and next due", async () => {
    signedInWith([{ entries: [deworming, vetVisit, rabies], next_cursor: null }]);

    const { container } = renderRoute(feed);

    await screen.findByText("Deworming");
    const rows = [...container.querySelectorAll<HTMLElement>(".ent")];
    const first = rows[0]!;
    expect(within(first).getByText(/12 Aug/)).toHaveTextContent("2026");
    expect(within(first).getByText("Half tablet, took it in cheese.")).toBeInTheDocument();
    expect(within(first).getByText(/Next due 12 Nov 2026/)).toBeInTheDocument();

    const second = rows[1]!;
    expect(within(second).getByText("Dr. Menon")).toBeInTheDocument();
    expect(within(second).queryByText(/Next due/)).toBeNull();
  });

  it("tags a future due date green and a passed one red, overdue", async () => {
    signedInWith([{ entries: [deworming, rabies], next_cursor: null }]);

    const { container } = renderRoute(feed);

    await screen.findByText("Deworming");
    const rows = [...container.querySelectorAll<HTMLElement>(".ent")];
    const fine = within(rows[0]!).getByText(/Next due 12 Nov 2026/);
    expect(fine).toHaveClass("tag", "next");

    const late = within(rows[1]!).getByText(/Next due 14 Jul 2026 — overdue/);
    expect(late).toHaveClass("tag", "late");
    expect(rows[1]).toHaveClass("ent", "over");
  });

  it("shows no due tag when an entry sets no next date, and no milestone tag ever", async () => {
    signedInWith([{ entries: [vetVisit], next_cursor: null }]);

    const { container } = renderRoute(feed);

    await screen.findByText("Vet visit");
    expect(container.querySelector(".tag.next")).toBeNull();
    expect(container.querySelector(".tag.late")).toBeNull();
    expect(container.querySelector(".tag.milestone")).toBeNull();
  });

  it("keeps older entries behind a control and pages them in by cursor", async () => {
    const asked = signedInWith([
      { entries: [deworming], next_cursor: "b3BhcXVl" },
      { entries: [vetVisit, rabies], next_cursor: null },
    ]);

    const { container } = renderRoute(feed);

    await screen.findByText("Deworming");
    expect(screen.queryByText("Vet visit")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /older/i }));

    await screen.findByText("Vet visit");
    const titles = [...container.querySelectorAll(".ent .ttl")].map((el) => el.textContent);
    expect(titles).toEqual(["Deworming", "Vet visit", "Rabies booster"]);
    expect(asked).toEqual([null, "b3BhcXVl"]);
    expect(screen.queryByRole("button", { name: /older/i })).toBeNull();
  });

  it("offers nothing to expand when the whole record already fits", async () => {
    signedInWith([{ entries: [deworming, vetVisit], next_cursor: null }]);

    renderRoute(feed);

    await screen.findByText("Deworming");
    expect(screen.queryByRole("button", { name: /older/i })).toBeNull();
  });

  it("opens with what this pet needs, above its history", async () => {
    signedInWith([{ entries: [deworming, rabies], next_cursor: null }], [outstanding]);
    setViewportWidth(1200);

    renderRoute(feed);

    const panel = (await screen.findByText("Due 14 Jul 2026")).closest<HTMLElement>("[data-layout]")!;

    expect(panel).toHaveAttribute("data-layout", "desktop");
    expect(within(panel).getByText("Rabies booster")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Last given 14 Jul 2025 at Anvayaa Clinic.");
    expect(panel).toHaveTextContent("Overdue 46 days");
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
  });

  it("draws the same panel in the mobile layout below the breakpoint", async () => {
    signedInWith([{ entries: [rabies], next_cursor: null }], [outstanding]);
    setViewportWidth(390);

    renderRoute(feed);

    const panel = (await screen.findByText("Due 14 Jul 2026")).closest<HTMLElement>("[data-layout]")!;

    expect(panel).toHaveAttribute("data-layout", "mobile");
    expect(panel).toHaveTextContent("Overdue 46d");
  });

  it("says nothing needs attention when nothing is outstanding", async () => {
    signedInWith([{ entries: [deworming], next_cursor: null }]);

    renderRoute(feed);

    await screen.findByText("Deworming");

    expect(screen.queryByText(/needs attention/i)).toBeNull();
  });

  it("marks an item done, dropping it from Needs attention while the entry stays in the history", async () => {
    signedInWith([{ entries: [deworming, rabies], next_cursor: null }], [outstanding]);
    let marked: string | null = null;
    server.use(
      http.post(`http://localhost:8000/entries/${rabies.id}/mark-done`, () => {
        marked = rabies.id;
        return HttpResponse.json({ ...rabies, is_overdue: false });
      }),
    );

    const { container } = renderRoute(feed);

    await userEvent.click(await screen.findByRole("button", { name: "Mark done" }));

    await waitFor(() => expect(screen.queryByText("Due 14 Jul 2026")).toBeNull());
    expect(marked).toBe(rabies.id);

    const rows = [...container.querySelectorAll<HTMLElement>(".ent")];
    const kept = rows.find((row) => row.textContent?.includes("Rabies booster"))!;
    expect(within(kept as HTMLElement).getByText(/Next due 14 Jul 2026/)).toBeInTheDocument();
    expect(within(kept as HTMLElement).queryByText(/overdue/i)).toBeNull();
  });

  it("offers only Mark done on an outstanding item — logging next now happens in chat", async () => {
    signedInWith([{ entries: [rabies], next_cursor: null }], [outstanding]);

    renderRoute(feed);

    await screen.findByText("Due 14 Jul 2026");
    expect(screen.getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /log the next one/i })).toBeNull();
  });

  it("points the bottom archive link at the About tab, where archiving lives", async () => {
    signedInWith([{ entries: [deworming], next_cursor: null }]);

    renderRoute(feed);

    expect(await screen.findByRole("link", { name: "Archive Biscuit" })).toHaveAttribute(
      "href",
      `/pets/${biscuit.id}/about`,
    );
  });
});

describe("a pet's photo on the feed", () => {
  it("shows the photo from our own API in place of the letter", async () => {
    signedInWith([{ entries: [], next_cursor: null }]);
    server.use(
      http.get(`http://localhost:8000/pets/${biscuit.id}`, () =>
        HttpResponse.json({ ...biscuit, has_photo: true, due_items: [] }),
      ),
    );

    renderRoute(feed);

    expect(await screen.findByRole("img", { name: "Biscuit" })).toHaveAttribute(
      "src",
      `http://localhost:8000/pets/${biscuit.id}/photo`,
    );
  });
});
