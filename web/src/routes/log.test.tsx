import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";
import type { Pet } from "../api";

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

const momo: Pet = {
  ...biscuit,
  id: "33333333-3333-3333-3333-333333333333",
  name: "Momo",
  species: "cat",
  breed: null,
  slug: "momo-9k2p",
};

/** Everything the log form loads, plus the feed it lands on afterwards. */
function signedIn(titles: string[] = []) {
  const sent: Record<string, unknown>[] = [];
  server.use(
    http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
    http.get("http://localhost:8000/pets", () => HttpResponse.json([biscuit, momo])),
    http.get("http://localhost:8000/entry-titles/recent", () => HttpResponse.json(titles)),
    http.post("http://localhost:8000/entries", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push(body);
      return HttpResponse.json({ id: "e1", is_overdue: false, ...body }, { status: 201 });
    }),
    ...[biscuit, momo].flatMap((pet) => [
      http.get(`http://localhost:8000/pets/${pet.id}`, () => HttpResponse.json(pet)),
      http.get(`http://localhost:8000/pets/${pet.id}/entries`, () =>
        HttpResponse.json({ entries: [], next_cursor: null }),
      ),
    ]),
  );
  return sent;
}

async function typeDate(label: string, value: string) {
  const field = screen.getByLabelText(label);
  await userEvent.clear(field);
  await userEvent.type(field, value);
}

describe("the log form", () => {
  it("saves an entry from a date and a title alone, in the desktop layout", async () => {
    const sent = signedIn();
    setViewportWidth(1200);

    const { container } = renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Nail trim");
    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(sent[0]).toEqual({
      pet_id: biscuit.id,
      title: "Nail trim",
      happened_on: "2026-08-29",
      due_on: null,
      vet: null,
      note: null,
    });
  });

  it("offers the same form in the mobile layout below the breakpoint", async () => {
    const sent = signedIn();
    setViewportWidth(390);

    const { container } = renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Nail trim");
    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
  });

  it("saves the vet and the note on the entry", async () => {
    const sent = signedIn();

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Vet visit");
    await typeDate("Date", "2026-06-02");
    await userEvent.type(screen.getByLabelText(/Vet or clinic/), "Dr. Menon");
    await userEvent.type(screen.getByLabelText(/Notes/), "Limping on the back right leg.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ vet: "Dr. Menon", note: "Limping on the back right leg." });
  });

  it("pre-selects the pet the form was opened from", async () => {
    const sent = signedIn();

    renderRoute(`/log?pet=${momo.id}`);

    expect(await screen.findByLabelText("Pet")).toHaveValue(momo.id);
    await userEvent.type(screen.getByLabelText("What happened"), "Nail trim");
    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ pet_id: momo.id });
  });

  it("lands on the pet's feed once the entry is saved", async () => {
    signedIn();

    renderRoute(`/log?pet=${momo.id}`);

    await userEvent.type(await screen.findByLabelText("What happened"), "Nail trim");
    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Momo" })).toBeInTheDocument();
  });

  it("puts a field the API rejected beside that field", async () => {
    signedIn();
    server.use(
      http.post("http://localhost:8000/entries", () =>
        HttpResponse.json(
          { detail: { field: "happened_on", message: "That date is in the future." } },
          { status: 422 },
        ),
      ),
    );

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Nail trim");
    await typeDate("Date", "2099-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByLabelText("Date")).toHaveAccessibleDescription(
      /date is in the future/,
    );
  });

  it("sets the date to today and to yesterday with no date entry", async () => {
    const sent = signedIn();
    // A fixed clock, so the two shortcuts can be checked against literals.
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 7, 1, 10, 30) });

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Nail trim");
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-01");

    // across a month boundary, where a naive subtraction would give day zero
    await userEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(screen.getByLabelText("Date")).toHaveValue("2026-07-31");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ happened_on: "2026-07-31" });
    vi.useRealTimers();
  });

  it("opens with today's date already filled in", async () => {
    signedIn();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 7, 1, 10, 30) });

    renderRoute("/log");

    expect(await screen.findByLabelText("Date")).toHaveValue("2026-08-01");
    vi.useRealTimers();
  });

  it.each([
    ["+1 mo", "2026-09-29"],
    ["+3 mo", "2026-11-29"],
    ["+6 mo", "2027-02-28"],
    ["+1 yr", "2027-08-29"],
    ["+3 yr", "2029-08-29"],
  ])("sets the next due date %s from the entry date", async (shortcut, expected) => {
    signedIn();

    renderRoute("/log");

    await screen.findByLabelText("What happened");
    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: shortcut }));

    expect(screen.getByLabelText(/Next one due/)).toHaveValue(expected);
  });

  it("clears the due date and the panel when nothing is due after this", async () => {
    const sent = signedIn();

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Grooming");
    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: "+6 mo" }));
    expect(screen.getByText(/home screen/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Nothing due after this/ }));

    expect(screen.getByLabelText(/Next one due/)).toHaveValue("");
    expect(screen.queryByText(/home screen/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ due_on: null });
  });

  it("says what a due date will and will not do before one is set", async () => {
    signedIn();

    renderRoute("/log");

    await screen.findByLabelText("What happened");
    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: "+1 yr" }));

    const panel = screen.getByText(/home screen/i);
    expect(panel).toHaveTextContent(/stays there until you log the next one/i);
    expect(panel).toHaveTextContent(/never email/i);
  });

  it("offers the handler's own recent titles as chips, capped at four", async () => {
    const sent = signedIn(["Rabies booster", "Deworming", "Grooming", "Vet visit"]);

    renderRoute("/log");

    for (const used of ["Rabies booster", "Deworming", "Grooming", "Vet visit"]) {
      expect(await screen.findByRole("button", { name: used })).toBeInTheDocument();
    }

    await userEvent.click(screen.getByRole("button", { name: "Deworming" }));
    expect(screen.getByLabelText("What happened")).toHaveValue("Deworming");

    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ title: "Deworming" });
  });

  it("suggests nothing to a handler who has logged nothing yet", async () => {
    signedIn([]);

    renderRoute("/log");

    expect(await screen.findByLabelText("What happened")).toHaveValue("");
    expect(screen.queryByText(/used/i)).toBeNull();
  });
});
