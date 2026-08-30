import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";
import type { PublicPet } from "../api";

/** The same JSON `GET /public/pets/{slug}` returns: no note, no vet, no id,
 *  and a date of birth already coarsened to a month and a year. */
const biscuit: PublicPet = {
  slug: "biscuit-a4f2",
  name: "Biscuit",
  species: "dog",
  breed: "Indian Pariah",
  colour: "Tan & white",
  sex: "male",
  born: "Mar 2022",
  age_years: 4,
  age_months: 5,
  has_photo: false,
  updated_on: "2026-08-12",
  entries: [
    { title: "Deworming", happened_on: "2026-08-12", due_on: "2026-11-12" },
    { title: "Vet visit", happened_on: "2026-06-02", due_on: null },
    { title: "Rabies booster", happened_on: "2025-07-14", due_on: "2026-07-14" },
  ],
};

const page = `/p/${biscuit.slug}`;

/** One labelled fact off the strip, read the way a visitor reads it. */
const fact = (label: string) => screen.getByText(label).parentElement;

function published(pet: PublicPet) {
  server.use(
    http.get(`http://localhost:8000/public/pets/${pet.slug}`, () => HttpResponse.json(pet)),
  );
}

describe("the public page", () => {
  it("shows the pet and its whole record in the desktop layout above the breakpoint", async () => {
    published(biscuit);
    setViewportWidth(1200);

    const { container } = renderRoute(page);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();
    expect(fact("Species")).toHaveTextContent("dog");
    expect(fact("Breed")).toHaveTextContent("Indian Pariah");
    expect(fact("Colour")).toHaveTextContent("Tan & white");
    expect(fact("Born")).toHaveTextContent("Mar 2022");
    // the line under the name carries the age on the wide layout
    expect(screen.getByRole("heading", { name: "Biscuit" }).parentElement).toHaveTextContent(
      /Indian Pariah.*male.*4 yrs 5 mo/,
    );
    for (const entry of biscuit.entries) {
      expect(screen.getByText(entry.title)).toBeInTheDocument();
    }
  });

  it("shows the same document in the mobile layout below the breakpoint", async () => {
    published(biscuit);
    setViewportWidth(390);

    const { container } = renderRoute(page);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
    // the age moves into the facts strip where the name line has no room
    expect(fact("Age")).toHaveTextContent("4 yrs 5 mo");
    expect(fact("Born")).toHaveTextContent("Mar 2022");
    expect(screen.getByText("Rabies booster")).toBeInTheDocument();
  });

  it("is a document, not an app screen: no navigation, no avatar, no sign-in prompt", async () => {
    published(biscuit);

    const { container } = renderRoute(page);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(screen.queryByText(/sign up/i)).toBeNull();
    // the app's own furniture: the shell, its top bar and its initials chip
    expect(container.querySelector(".shell-desktop, .shell-mobile, .topbar, .chip")).toBeNull();
    // the footer mark is the one nod to the app, and it is not a way in
    expect(screen.getByText(/^Paw$/)).toBeInTheDocument();
  });

  it("is unsigned: it names the pet's owner and never the handler", async () => {
    published(biscuit);

    renderRoute(page);

    expect(await screen.findByText(/shared by/i)).toHaveTextContent(
      /Shared by Biscuit.s owner\./,
    );
    expect(screen.queryByText(/Akhil/)).toBeNull();
  });

  it("prints a due date in neutral grey with no overdue stamp", async () => {
    // The last entry's due date is long past. The handler's own screens would
    // stamp it; this page does not know and does not say.
    published(biscuit);

    const { container } = renderRoute(page);

    expect(await screen.findByText("Rabies booster")).toBeInTheDocument();
    // the date, and nothing else: no days-late count, no stamp, no colour on it
    expect(screen.getByText(/Next 14 Jul 2026/)).toHaveTextContent(/^Next 14 Jul 2026$/);
    expect(container.querySelector(".stamp, .over, .hot")).toBeNull();
    expect(screen.queryByText(/overdue/i)).toBeNull();
    expect(screen.queryByText(/due today/i)).toBeNull();
  });
  it("says only that the page is not available when the API 404s", async () => {
    // Private, archived or never-existed: the API answers all three the same,
    // and so does this.
    server.use(
      http.get("http://localhost:8000/public/pets/gone-0000", () =>
        HttpResponse.json({ detail: "No such page." }, { status: 404 }),
      ),
    );

    renderRoute("/p/gone-0000");

    expect(await screen.findByText(/not available/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("a public page's photo", () => {
  it("renders it from our own API, keyed on the slug and never on Supabase", async () => {
    published({ ...biscuit, has_photo: true });

    const { container } = renderRoute(page);

    expect(await screen.findByRole("img", { name: "Biscuit" })).toHaveAttribute(
      "src",
      `http://localhost:8000/public/pets/${biscuit.slug}/photo`,
    );
    expect(container.innerHTML).not.toMatch(/supabase/i);
  });

  it("shows the initial-letter avatar when there is no photo", async () => {
    published(biscuit);

    renderRoute(page);

    expect(await screen.findByRole("heading", { name: "Biscuit" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
});
