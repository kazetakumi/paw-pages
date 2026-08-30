import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
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
    expect(screen.getByText("male")).toBeInTheDocument();
    expect(screen.getByText("Tan & white")).toBeInTheDocument();
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
