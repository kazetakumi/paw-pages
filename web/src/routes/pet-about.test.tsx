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
  is_public: false,
  has_photo: false,
  age_years: 4,
  age_months: 5,
};

const about = `/pets/${biscuit.id}/about`;

function signedInWith(pet: Pet) {
  server.use(
    http.get("http://localhost:8000/me", () => HttpResponse.json(me)),
    http.get(`http://localhost:8000/pets/${pet.id}`, () => HttpResponse.json(pet)),
  );
}

describe("a pet's About tab", () => {
  it("shows every identity field in the desktop layout above the breakpoint", async () => {
    signedInWith(biscuit);
    setViewportWidth(1200);

    const { container } = renderRoute(about);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();
    for (const shown of ["Species", "Breed", "Sex", "Colour"]) {
      expect(screen.getByText(shown)).toBeInTheDocument();
    }
    expect(screen.getByText("dog")).toBeInTheDocument();
    expect(screen.getByText("Indian Pariah")).toBeInTheDocument();
    expect(screen.getByText("Male")).toBeInTheDocument();
    expect(screen.getByText("Tan & white")).toBeInTheDocument();
  });

  it("capitalises the sex in the identity row but leaves the header line alone", async () => {
    signedInWith(biscuit);
    setViewportWidth(1200);

    renderRoute(about);

    // The drawing has "Male" in the row and "male" in the line under the name.
    expect(await screen.findByText("Male")).toBeInTheDocument();
    expect(screen.getByText(/Indian Pariah ·/)).toHaveTextContent("male");
  });

  it("shows the same identity in the mobile layout below the breakpoint", async () => {
    signedInWith(biscuit);
    setViewportWidth(390);

    const { container } = renderRoute(about);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
    expect(screen.getByText("Indian Pariah")).toBeInTheDocument();
    expect(screen.getByText("Tan & white")).toBeInTheDocument();
  });

  it("shows the age beside the date of birth, with the approximate flag visible", async () => {
    signedInWith(biscuit);

    renderRoute(about);

    const born = await screen.findByText(/12 Mar 2022/);
    expect(born).toHaveTextContent(/approx/i);
    expect(born).toHaveTextContent("4 yrs 5 mo");
  });

  it("says so plainly when a pet has no date of birth", async () => {
    signedInWith({ ...biscuit, date_of_birth: null, dob_is_approx: false, age_years: null, age_months: null });

    renderRoute(about);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(screen.queryByText(/approx/i)).not.toBeInTheDocument();
  });

  it("saves an edit to any identity field", async () => {
    signedInWith(biscuit);
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.patch(`http://localhost:8000/pets/${biscuit.id}`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...biscuit, ...sent });
      }),
    );

    renderRoute(about);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));

    // every identity field, editable after the fact
    for (const field of ["Name", "Species", "Breed", "Sex", "Date of birth", "Colour"]) {
      expect(screen.getByLabelText(field)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/approximate/i)).toBeInTheDocument();

    const colour = screen.getByLabelText("Colour");
    await userEvent.clear(colour);
    await userEvent.type(colour, "Brindle");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Brindle")).toBeInTheDocument();
    expect(sent).toMatchObject({ colour: "Brindle", name: "Biscuit", species: "dog" });
  });

  it("puts a field the API rejected beside that field", async () => {
    signedInWith({ ...biscuit, date_of_birth: null, dob_is_approx: false, age_years: null, age_months: null });
    server.use(
      http.patch(`http://localhost:8000/pets/${biscuit.id}`, () =>
        HttpResponse.json(
          {
            detail: {
              field: "dob_is_approx",
              message: "Mark a date of birth approximate only when there is a date.",
            },
          },
          { status: 422 },
        ),
      ),
    );

    renderRoute(about);
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByLabelText(/approximate/i));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByLabelText(/approximate/i)).toHaveAccessibleDescription(
      /only when there is a date/,
    );
  });
});

describe("a pet's public page, from the About tab", () => {
  it("states what the page will and will not reveal before the switch is thrown", async () => {
    signedInWith(biscuit);

    renderRoute(about);

    expect(await screen.findByRole("switch", { name: /public page/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    const shows = screen.getByText(/anyone with this link sees/i);
    expect(shows).toHaveTextContent(/name, species, breed, colour and age/i);
    expect(shows).toHaveTextContent(/every entry.s date and title/i);
    expect(screen.getByText(/never shown/i)).toHaveTextContent(
      /your name, contact details, notes and clinic names/i,
    );
    expect(screen.getByText(/month and year/i)).toBeInTheDocument();
  });

  it("shows no link until the page is on, then the link the slug claimed", async () => {
    signedInWith(biscuit);
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.patch(`http://localhost:8000/pets/${biscuit.id}`, async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...biscuit, ...sent });
      }),
    );

    renderRoute(about);
    expect(await screen.findByRole("switch", { name: /public page/i })).toBeInTheDocument();
    expect(screen.queryByText(/\/p\/biscuit-a4f2/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: /public page/i }));

    expect(await screen.findByText(/\/p\/biscuit-a4f2/)).toBeInTheDocument();
    expect(sent).toEqual({ is_public: true });
    expect(screen.getByRole("switch", { name: /public page/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("copies the link in one action", async () => {
    const user = userEvent.setup();
    signedInWith({ ...biscuit, is_public: true });

    renderRoute(about);

    await user.click(await screen.findByRole("button", { name: /copy/i }));

    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/p/biscuit-a4f2`,
    );
  });

  it("takes the link away the moment the page is switched off", async () => {
    signedInWith({ ...biscuit, is_public: true });
    server.use(
      http.patch(`http://localhost:8000/pets/${biscuit.id}`, () =>
        HttpResponse.json({ ...biscuit, is_public: false }),
      ),
    );

    renderRoute(about);
    expect(await screen.findByText(/\/p\/biscuit-a4f2/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: /public page/i }));

    await waitFor(() => expect(screen.queryByText(/\/p\/biscuit-a4f2/)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });
});

describe("a pet's photo, from the About tab", () => {
  const photoSrc = `http://localhost:8000/pets/${biscuit.id}/photo`;

  it("renders the photo from our own API and never from Supabase", async () => {
    signedInWith({ ...biscuit, has_photo: true });

    const { container } = renderRoute(about);

    expect(await screen.findByRole("img", { name: "Biscuit" })).toHaveAttribute("src", photoSrc);
    expect(container.innerHTML).not.toMatch(/supabase/i);
  });

  it("falls back to the initial-letter avatar when there is no photo", async () => {
    signedInWith(biscuit);

    renderRoute(about);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Biscuit" })).not.toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("uploads a chosen photo and shows it in place of the letter", async () => {
    signedInWith(biscuit);
    let sentType: string | null = null;
    server.use(
      http.put(`http://localhost:8000/pets/${biscuit.id}/photo`, ({ request }) => {
        sentType = request.headers.get("content-type");
        return HttpResponse.json({ ...biscuit, has_photo: true });
      }),
    );

    renderRoute(about);
    await userEvent.upload(
      await screen.findByLabelText(/photo/i),
      new File(["bytes"], "biscuit.jpg", { type: "image/jpeg" }),
    );

    expect(await screen.findByRole("img", { name: "Biscuit" })).toHaveAttribute("src", photoSrc);
    expect(sentType).toBe("image/jpeg");
  });

  it("removes the photo and falls back to the initial-letter avatar", async () => {
    signedInWith({ ...biscuit, has_photo: true });
    server.use(
      http.delete(`http://localhost:8000/pets/${biscuit.id}/photo`, () =>
        HttpResponse.json({ ...biscuit, has_photo: false }),
      ),
    );

    renderRoute(about);
    await userEvent.click(await screen.findByRole("button", { name: /remove photo/i }));

    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "Biscuit" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("offers no way to remove a photo that is not there", async () => {
    signedInWith(biscuit);

    renderRoute(about);

    expect(await screen.findByLabelText(/photo/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove photo/i })).not.toBeInTheDocument();
  });

  it("puts a photo the API refused beside the control", async () => {
    signedInWith(biscuit);
    server.use(
      http.put(`http://localhost:8000/pets/${biscuit.id}/photo`, () =>
        HttpResponse.json(
          { detail: { field: "photo", message: "That image is over 5 MB. Choose a smaller one." } },
          { status: 422 },
        ),
      ),
    );

    renderRoute(about);
    await userEvent.upload(
      await screen.findByLabelText(/photo/i),
      new File(["much too much"], "huge.jpg", { type: "image/jpeg" }),
    );

    expect(await screen.findByLabelText(/photo/i)).toHaveAccessibleDescription(/over 5 MB/);
  });

  it("gives the upload control a desktop layout above the breakpoint", async () => {
    signedInWith(biscuit);
    setViewportWidth(1200);

    const { container } = renderRoute(about);

    expect(await screen.findByLabelText(/photo/i)).toBeInTheDocument();
    expect(container.querySelector('[data-photo="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-photo="mobile"]')).toBeNull();
  });

  it("gives it a mobile layout below the breakpoint", async () => {
    signedInWith(biscuit);
    setViewportWidth(390);

    const { container } = renderRoute(about);

    expect(await screen.findByLabelText(/photo/i)).toBeInTheDocument();
    expect(container.querySelector('[data-photo="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-photo="desktop"]')).toBeNull();
  });
});

describe("archiving a pet", () => {
  it("states what archiving does before anything is confirmed", async () => {
    signedInWith(biscuit);

    renderRoute(about);

    const panel = await screen.findByRole("region", { name: "Archive" });

    expect(panel).toHaveTextContent(/keeps Biscuit['’]s history and photo/i);
    expect(panel).toHaveTextContent(/stops (his|her|their|its) due dates counting/i);
    expect(panel).toHaveTextContent(/takes (his|her|their|its) public page offline/i);
    expect(panel).toHaveTextContent(/undo it any time/i);
    // Nothing has been asked of the API yet: this is the sentence, not the act.
    expect(screen.queryByRole("button", { name: /^Archive Biscuit$/ })).toBeInTheDocument();
  });

  it("asks for a reason and sends the one chosen", async () => {
    signedInWith(biscuit);
    let sent: unknown = null;
    server.use(
      http.post(`http://localhost:8000/pets/${biscuit.id}/archive`, async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(biscuit);
      }),
    );

    server.use(
      http.get("http://localhost:8000/dashboard", () =>
        HttpResponse.json({
          ledger: [],
          pets: [],
          active_pets: 0,
          overdue: 0,
          due_within_30_days: 0,
          archived_pets: 1,
          archived: [
            {
              id: biscuit.id,
              name: "Biscuit",
              archived_reason: "rehomed",
              archived_on: "2026-08-30",
            },
          ],
        }),
      ),
    );

    renderRoute(about);
    await userEvent.click(await screen.findByRole("button", { name: /^Archive Biscuit$/ }));
    await userEvent.click(screen.getByRole("radio", { name: /rehomed/i }));
    await userEvent.click(screen.getByRole("button", { name: /^Archive$/ }));

    await waitFor(() => expect(sent).toEqual({ reason: "rehomed" }));
    // Archived pets live on the home screen now, as a count rather than a card.
    expect(await screen.findByRole("heading", { name: "Your pets" })).toBeInTheDocument();
  });

  it("will not archive until a reason is chosen", async () => {
    signedInWith(biscuit);

    renderRoute(about);
    await userEvent.click(await screen.findByRole("button", { name: /^Archive Biscuit$/ }));

    expect(screen.getByRole("button", { name: /^Archive$/ })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Archive" })).toHaveTextContent(
      /keeps Biscuit['’]s history and photo/i,
    );
  });

  it("backs out without archiving", async () => {
    signedInWith(biscuit);

    renderRoute(about);
    await userEvent.click(await screen.findByRole("button", { name: /^Archive Biscuit$/ }));
    await userEvent.click(screen.getByRole("button", { name: /keep Biscuit/i }));

    expect(screen.queryByRole("radio", { name: /rehomed/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Archive Biscuit$/ })).toBeInTheDocument();
  });

  it("gives the panel a desktop layout above the breakpoint", async () => {
    signedInWith(biscuit);
    setViewportWidth(1200);

    const { container } = renderRoute(about);

    await screen.findByRole("region", { name: "Archive" });

    expect(container.querySelector('[data-archive="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-archive="mobile"]')).toBeNull();
  });

  it("gives it a mobile layout below the breakpoint", async () => {
    signedInWith(biscuit);
    setViewportWidth(390);

    const { container } = renderRoute(about);

    await screen.findByRole("region", { name: "Archive" });

    expect(container.querySelector('[data-archive="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-archive="desktop"]')).toBeNull();
  });

});
