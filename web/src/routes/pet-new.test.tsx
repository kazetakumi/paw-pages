import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";

const me = { id: "11111111-1111-1111-1111-111111111111", name: "Akhil" };

const created = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Biscuit",
  species: "dog",
  breed: null,
  sex: null,
  date_of_birth: null,
  dob_is_approx: false,
  colour: null,
  slug: "biscuit-a4f2",
  is_public: false,
  has_photo: false,
  age_years: null,
  age_months: null,
};

function signedIn() {
  server.use(http.get("http://localhost:8000/me", () => HttpResponse.json(me)));
}

describe("adding a pet", () => {
  it("takes a name and a species alone and lands on the new pet's About tab", async () => {
    signedIn();
    let sent: Record<string, unknown> | null = null;
    server.use(
      http.post("http://localhost:8000/pets", async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get(`http://localhost:8000/pets/${created.id}`, () => HttpResponse.json(created)),
    );

    renderRoute("/pets/new");
    await userEvent.type(await screen.findByLabelText("Name"), "Biscuit");
    await userEvent.type(screen.getByLabelText("Species"), "dog");
    await userEvent.click(screen.getByRole("button", { name: "Add pet" }));

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(sent).toMatchObject({ name: "Biscuit", species: "dog", breed: null, sex: null });
  });

  it("puts a field the API rejected beside that field", async () => {
    signedIn();
    server.use(
      http.post("http://localhost:8000/pets", () =>
        HttpResponse.json(
          { detail: { field: "species", message: "String should have at most 40 characters" } },
          { status: 422 },
        ),
      ),
    );

    renderRoute("/pets/new");
    await userEvent.type(await screen.findByLabelText("Name"), "Biscuit");
    await userEvent.type(screen.getByLabelText("Species"), "x".repeat(41));
    await userEvent.click(screen.getByRole("button", { name: "Add pet" }));

    expect(await screen.findByLabelText("Species")).toHaveAccessibleDescription(
      /at most 40 characters/,
    );
    expect(screen.getByLabelText("Name")).not.toHaveAccessibleDescription();
  });

  it("draws the mobile layout below the breakpoint", async () => {
    signedIn();
    setViewportWidth(390);

    const { container } = renderRoute("/pets/new");

    expect(await screen.findByLabelText("Name")).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
  });
});
