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

  it("edits an entry in place, behind the same Save button as a new one", async () => {
    signedInWith([{ entries: [deworming, vetVisit], next_cursor: null }]);
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.get("http://localhost:8000/pets", () => HttpResponse.json([biscuit])),
      http.get("http://localhost:8000/entry-titles/recent", () => HttpResponse.json([])),
      http.patch(`http://localhost:8000/entries/${deworming.id}`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...deworming, ...sent });
      }),
    );

    renderRoute(feed);

    const card = (await screen.findByRole("heading", { name: "Deworming" })).closest("article")!;
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("What happened")).toHaveValue("Deworming");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-12");
    const note = screen.getByLabelText(/Notes/);
    await userEvent.clear(note);
    await userEvent.type(note, "Whole tablet this time.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Whole tablet this time.")).toBeInTheDocument();
    expect(sent).toMatchObject({ title: "Deworming", note: "Whole tablet this time." });
    expect(screen.queryByLabelText("What happened")).toBeNull();
  });

  it("deletes an entry and drops it out of the record", async () => {
    signedInWith([{ entries: [deworming, vetVisit], next_cursor: null }]);
    let deleted: string | null = null;
    server.use(
      http.delete(`http://localhost:8000/entries/${vetVisit.id}`, () => {
        deleted = vetVisit.id;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderRoute(feed);

    const card = (await screen.findByRole("heading", { name: "Vet visit" })).closest("article")!;
    await userEvent.click(within(card).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Vet visit" })).toBeNull());
    expect(deleted).toBe(vetVisit.id);
    expect(screen.getByRole("heading", { name: "Deworming" })).toBeInTheDocument();
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

    await screen.findByRole("heading", { name: "Deworming" });

    expect(screen.queryByText(/needs attention/i)).toBeNull();
  });

  it("marks an item done, dropping it while the entry stays in the history", async () => {
    signedInWith([{ entries: [deworming, rabies], next_cursor: null }], [outstanding]);
    let marked: string | null = null;
    server.use(
      http.post(`http://localhost:8000/entries/${rabies.id}/mark-done`, () => {
        marked = rabies.id;
        return HttpResponse.json({ ...rabies, is_overdue: false });
      }),
    );

    renderRoute(feed);

    await userEvent.click(await screen.findByRole("button", { name: "Mark done" }));

    await waitFor(() => expect(screen.queryByText("Due 14 Jul 2026")).toBeNull());
    expect(marked).toBe(rabies.id);

    const kept = screen.getByRole("heading", { name: "Rabies booster" }).closest("article")!;
    expect(within(kept).getByText(/Next due 14 Jul 2026/)).toBeInTheDocument();
    expect(within(kept).queryByText(/overdue/i)).toBeNull();
  });

  it("opens the log form pre-filled from the outstanding item", async () => {
    signedInWith([{ entries: [rabies], next_cursor: null }], [outstanding]);

    renderRoute(feed);

    await userEvent.click(await screen.findByRole("button", { name: "Log the next one" }));

    expect(screen.getByLabelText("What happened")).toHaveValue("Rabies booster");
    expect(screen.getByLabelText(/Vet or clinic/)).toHaveValue("Anvayaa Clinic");
    // A new entry, not a correction: today, with nothing yet due after it.
    expect(screen.getByLabelText("Date")).not.toHaveValue("2025-07-14");
    expect(screen.getByLabelText(/Next one due/)).toHaveValue("");
  });

  it("logs the next one and closes the old due date in the one request", async () => {
    let sent: Record<string, unknown> | null = null;
    const next: Entry = {
      ...rabies,
      id: "a4",
      happened_on: "2026-08-29",
      due_on: "2027-08-29",
      is_overdue: false,
    };
    signedInWith([{ entries: [rabies], next_cursor: null }], [outstanding]);
    server.use(
      http.post("http://localhost:8000/entries", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        // Closing it is the API's job, so the reload sees the item gone.
        server.use(
          http.get(`http://localhost:8000/pets/${biscuit.id}`, () =>
            HttpResponse.json({ ...biscuit, due_items: [] }),
          ),
          http.get(`http://localhost:8000/pets/${biscuit.id}/entries`, () =>
            HttpResponse.json({ entries: [next, rabies], next_cursor: null }),
          ),
        );
        return HttpResponse.json(next, { status: 201 });
      }),
    );

    renderRoute(feed);

    await userEvent.click(await screen.findByRole("button", { name: "Log the next one" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByText("Due 14 Jul 2026")).toBeNull());
    expect(sent).toMatchObject({
      pet_id: biscuit.id,
      title: "Rabies booster",
      closes_entry_id: rabies.id,
    });
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Rabies booster",
      "Rabies booster",
    ]);
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
