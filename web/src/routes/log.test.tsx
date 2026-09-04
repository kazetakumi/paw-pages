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
  is_public: false,
  has_photo: false,
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
  is_public: false,
  has_photo: false,
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
      http.get(`http://localhost:8000/pets/${pet.id}`, () =>
        HttpResponse.json({ ...pet, due_items: [] }),
      ),
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
      // Nothing to close: a plain log is not "log the next one".
      closes_entry_id: null,
      pet_id: biscuit.id,
      title: "Nail trim",
      happened_on: "2026-08-29",
      due_on: null,
      vet: null,
      note: null,
      weight_value: null,
      weight_unit: null,
      photo_is_public: false,
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
  it("saves a weight with the unit that was picked", async () => {
    const sent = signedIn();
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Weighed");
    await typeDate("Date", "2026-08-29");
    await userEvent.type(screen.getByLabelText(/Weight/), "12.4");
    await userEvent.selectOptions(screen.getByLabelText("Unit"), "lb");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ weight_value: "12.4", weight_unit: "lb" });
  });

  it("defaults the unit to kg without making the handler pick one", async () => {
    const sent = signedIn();
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Weighed");
    await typeDate("Date", "2026-08-29");
    await userEvent.type(screen.getByLabelText(/Weight/), "12.4");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ weight_value: "12.4", weight_unit: "kg" });
  });

  it("sends neither half when the weight is left blank", async () => {
    const sent = signedIn();
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Nail trim");
    await typeDate("Date", "2026-08-29");
    await userEvent.selectOptions(screen.getByLabelText("Unit"), "lb");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ weight_value: null, weight_unit: null });
  });
  it("uploads a chosen photo after the entry it belongs to is saved", async () => {
    const sent = signedIn();
    const uploaded: string[] = [];
    server.use(
      http.put("http://localhost:8000/entries/:id/photo", ({ params }) => {
        uploaded.push(params["id"] as string);
        return HttpResponse.json({ id: params["id"], has_photo: true, pet_id: biscuit.id });
      }),
    );
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Vet visit");
    await typeDate("Date", "2026-08-29");
    await userEvent.upload(
      screen.getByLabelText(/Photo/),
      new File(["bytes"], "rash.jpg", { type: "image/jpeg" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // The entry is written first: the photo has nothing to hang on until then.
    await waitFor(() => expect(uploaded).toEqual(["e1"]));
    expect(sent).toHaveLength(1);
  });

  it("writes the entry once when the photo upload fails and Save is pressed again", async () => {
    const sent = signedIn();
    let attempts = 0;
    server.use(
      http.put("http://localhost:8000/entries/:id/photo", () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ id: "e1", has_photo: true, pet_id: biscuit.id });
      }),
    );
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Vet visit");
    await typeDate("Date", "2026-08-29");
    await userEvent.upload(
      screen.getByLabelText(/Photo/),
      new File(["bytes"], "rash.jpg", { type: "image/jpeg" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // Two upload attempts, but only ever one entry.
    await waitFor(() => expect(attempts).toBe(2));
    expect(sent).toHaveLength(1);
  });

  it("saves an entry with no photo when none was chosen", async () => {
    const sent = signedIn();
    let uploads = 0;
    server.use(
      http.put("http://localhost:8000/entries/:id/photo", () => {
        uploads += 1;
        return HttpResponse.json({});
      }),
    );
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Nail trim");
    await typeDate("Date", "2026-08-29");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(uploads).toBe(0);
  });
  /** The order is a decision, so it is pinned. `.f > label` is every field's
   *  own label in document order; the unit select's hidden label sits inside
   *  the weight control rather than the field, so it does not appear here. */
  const fieldOrder = (container: HTMLElement) =>
    [...container.querySelectorAll(".f > label")].map((one) =>
      one.textContent!.replace(/\s*optional$/, "").trim(),
    );

  const ORDER = [
    "Pet",
    "What happened",
    "Date",
    "Vet or clinic",
    "Next one due",
    "Notes",
    "Weight",
    "Photo",
  ];

  it("orders the fields with the record first and the attachments last, on desktop", async () => {
    signedIn();
    setViewportWidth(1200);

    const { container } = renderRoute("/log");

    await screen.findByLabelText("What happened");
    expect(fieldOrder(container)).toEqual(ORDER);
  });

  it("uses that same order in the mobile layout", async () => {
    signedIn();
    setViewportWidth(390);

    const { container } = renderRoute("/log");

    await screen.findByLabelText("What happened");
    expect(fieldOrder(container)).toEqual(ORDER);
  });
  it("offers no publish toggle until a photo is chosen", async () => {
    signedIn();
    setViewportWidth(1200);

    renderRoute("/log");

    await screen.findByLabelText("What happened");
    expect(screen.queryByLabelText(/Show this photo on the public page/)).toBeNull();
  });

  it("warns what publishing means, where the choice is made", async () => {
    signedIn();
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.upload(
      await screen.findByLabelText(/Photo/),
      new File(["bytes"], "cert.jpg", { type: "image/jpeg" }),
    );

    expect(screen.getByLabelText(/Show this photo on the public page/)).not.toBeChecked();
    expect(screen.getByText(/name, address and phone number/)).toBeInTheDocument();
  });

  it("leaves a photo unpublished unless the toggle is ticked", async () => {
    const sent = signedIn();
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Rabies booster");
    await typeDate("Date", "2026-08-29");
    await userEvent.upload(
      screen.getByLabelText(/Photo/),
      new File(["bytes"], "cert.jpg", { type: "image/jpeg" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ photo_is_public: false });
  });

  it("publishes the photo when the toggle is ticked", async () => {
    const sent = signedIn();
    setViewportWidth(1200);

    renderRoute("/log");

    await userEvent.type(await screen.findByLabelText("What happened"), "Rabies booster");
    await typeDate("Date", "2026-08-29");
    await userEvent.upload(
      screen.getByLabelText(/Photo/),
      new File(["bytes"], "cert.jpg", { type: "image/jpeg" }),
    );
    await userEvent.click(screen.getByLabelText(/Show this photo on the public page/));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ photo_is_public: true });
  });
});
