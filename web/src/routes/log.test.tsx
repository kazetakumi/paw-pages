import { describe, expect, it } from "vitest";
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
});
