import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";
import type { ArchivedPet, Dashboard, Handler } from "../api";

const akhil: Handler = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Akhil",
  email: "akhil@example.com",
  joined_on: "2025-07-02",
  pet_count: 3,
  entry_count: 47,
  date_of_birth: null,
  gender: null,
  nationality: null,
  age: null,
};

const toffee: ArchivedPet = {
  id: "44444444-4444-4444-4444-444444444444",
  name: "Toffee",
  archived_reason: "passed_away",
  archived_on: "2026-02-14",
};

const emptyBoard: Dashboard = {
  ledger: [],
  pets: [],
  active_pets: 0,
  overdue: 0,
  due_within_30_days: 0,
  archived_pets: 0,
  archived: [],
};

/** The account screen asks /me for the handler and /dashboard for the
 *  archived-pets card, so every test that renders it stubs both. */
function signedInAs(handler: Handler, archived: ArchivedPet[] = []) {
  server.use(
    http.get("http://localhost:8000/me", () => HttpResponse.json(handler)),
    http.get("http://localhost:8000/dashboard", () =>
      HttpResponse.json({ ...emptyBoard, archived, archived_pets: archived.length }),
    ),
    // The sidebar's conversation list -- irrelevant to this screen, empty is fine.
    http.get("http://localhost:8000/conversations", () => HttpResponse.json([])),
  );
}

describe("the account screen", () => {
  it("shows the join date and the pet and entry counts, in the desktop layout", async () => {
    signedInAs(akhil);
    setViewportWidth(1200);

    const { container } = renderRoute("/account");

    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    const since = screen.getByText(/keeping records since/i);
    expect(since).toHaveTextContent("2 Jul 2025");
    expect(since).toHaveTextContent("3 pets");
    expect(since).toHaveTextContent("47 entries");
    expect(container.querySelector('[data-account="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-account="mobile"]')).toBeNull();
  });

  it("shows the same account in the mobile layout below the breakpoint", async () => {
    signedInAs(akhil);
    setViewportWidth(390);

    const { container } = renderRoute("/account");

    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(screen.getByText(/keeping records since/i)).toHaveTextContent("2 Jul 2025");
    expect(container.querySelector('[data-account="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-account="desktop"]')).toBeNull();
  });
});

describe("changing what the account holds", () => {
  it("changes the display name through PATCH /me", async () => {
    signedInAs(akhil);
    let sent: unknown = null;
    server.use(
      http.patch("http://localhost:8000/me", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...akhil, name: "Akhil J P" });
      }),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: /change name/i }));
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Akhil J P");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // On the row and in the shell alike: it is what the app calls them now.
    await waitFor(() => expect(screen.getAllByText("Akhil J P")).toHaveLength(2));
    expect(screen.getByRole("button", { name: /change name/i })).toBeInTheDocument();
    expect(sent).toEqual({ name: "Akhil J P" });
  });

  it("changes the email address through its own endpoint", async () => {
    signedInAs(akhil);
    let sent: unknown = null;
    server.use(
      http.patch("http://localhost:8000/me/email", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...akhil, email: "akhil@newmail.example" });
      }),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: /change email/i }));
    const email = screen.getByLabelText("Email");
    await userEvent.clear(email);
    await userEvent.type(email, "akhil@newmail.example");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("akhil@newmail.example")).toBeInTheDocument();
    expect(sent).toEqual({ email: "akhil@newmail.example" });
  });

  it("changes the password through its own endpoint without showing it back", async () => {
    signedInAs(akhil);
    let sent: unknown = null;
    server.use(
      http.patch("http://localhost:8000/me/password", async ({ request }) => {
        sent = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: /change password/i }));
    await userEvent.type(screen.getByLabelText("Password"), "a longer secret");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(sent).toEqual({ password: "a longer secret" }));
    expect(screen.queryByText("a longer secret")).not.toBeInTheDocument();
  });

  it("puts an email the API refused beside the email field", async () => {
    signedInAs(akhil);
    server.use(
      http.patch("http://localhost:8000/me/email", () =>
        HttpResponse.json(
          {
            detail: {
              field: "email",
              message: "That email already has an account. Sign in instead.",
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: /change email/i }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByLabelText("Email")).toHaveAccessibleDescription(
      /already has an account/,
    );
  });

  it("puts a date of birth the API refused beside the date of birth field", async () => {
    signedInAs(akhil);
    server.use(
      http.patch("http://localhost:8000/me", () =>
        HttpResponse.json(
          {
            detail: {
              field: "date_of_birth",
              message: "A date of birth cannot be in the future.",
            },
          },
          { status: 422 },
        ),
      ),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: /add date of birth/i }));
    await userEvent.type(screen.getByLabelText("Date of birth"), "2099-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByLabelText("Date of birth")).toHaveAccessibleDescription(
      /cannot be in the future/,
    );
  });
});

describe("the three optional personal fields", () => {
  it("says they are unset until they are filled in", async () => {
    signedInAs(akhil);

    renderRoute("/account");

    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    for (const label of ["Date of birth", "Gender", "Nationality"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Not set")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /add nationality/i })).toBeInTheDocument();
  });

  it("shows the age the API derived, and says it is never stored", async () => {
    signedInAs({ ...akhil, date_of_birth: "1994-08-14", age: 32, gender: "Male" });

    renderRoute("/account");

    expect(await screen.findByText("14 Aug 1994")).toBeInTheDocument();
    expect(screen.getByText(/you are 32/i)).toHaveTextContent(/never stored/i);
    expect(screen.getByText("Male")).toBeInTheDocument();
  });

  it("saves one of them without touching the other two", async () => {
    signedInAs(akhil);
    let sent: unknown = null;
    server.use(
      http.patch("http://localhost:8000/me", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...akhil, nationality: "Indian" });
      }),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: /add nationality/i }));
    await userEvent.type(screen.getByLabelText("Nationality"), "Indian");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Indian")).toBeInTheDocument();
    expect(sent).toEqual({ nationality: "Indian" });
  });
});

describe("archived pets", () => {
  it("says nothing when the handler has none archived", async () => {
    signedInAs(akhil);

    renderRoute("/account");

    expect(await screen.findByRole("heading", { name: "Your account" })).toBeInTheDocument();
    expect(screen.queryByText("Archived pets")).not.toBeInTheDocument();
  });

  it("names each one with why and when it was archived, and offers to restore it", async () => {
    signedInAs(akhil, [toffee]);

    renderRoute("/account");

    expect(await screen.findByText("Archived pets")).toBeInTheDocument();
    expect(screen.getByText("Toffee")).toBeInTheDocument();
    expect(screen.getByText("Passed away · archived 14 Feb 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("restores one through the real endpoint and drops it off the list", async () => {
    signedInAs(akhil, [toffee]);
    let restored: string | null = null;
    server.use(
      http.post("http://localhost:8000/pets/44444444-4444-4444-4444-444444444444/restore", () => {
        restored = toffee.id;
        signedInAs(akhil, []);
        return HttpResponse.json({});
      }),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => expect(restored).toBe(toffee.id));
    await waitFor(() => expect(screen.queryByText("Toffee")).not.toBeInTheDocument());
    expect(screen.queryByText("Archived pets")).not.toBeInTheDocument();
  });
});

describe("taking the data away, and leaving", () => {
  it("offers the export as one file from our own API", async () => {
    signedInAs(akhil);

    const { container } = renderRoute("/account");

    const download = await screen.findByRole("link", { name: /download my data/i });
    expect(download).toHaveAttribute("href", "http://localhost:8000/me/export");
    expect(screen.getByText(/every pet, every entry and every photo/i)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/supabase/i);
  });

  it("names exactly what deletion erases, the three optional fields included", async () => {
    signedInAs(akhil);

    renderRoute("/account");

    const kills = await screen.findByRole("list");
    expect(kills).toHaveTextContent(/date of birth, gender and nationality/i);
    expect(kills).toHaveTextContent(/name/i);
    expect(kills).toHaveTextContent(/email/i);
    expect(kills).toHaveTextContent(/3 pets/);
    expect(kills).toHaveTextContent(/47 entries/);
    expect(kills).toHaveTextContent(/every photo/i);
    expect(kills).toHaveTextContent(/public page/i);
    expect(screen.getByText(/cannot be undone/i)).toHaveTextContent(/download your data first/i);
  });

  it("asks once more before deleting, and backs out without asking the API", async () => {
    signedInAs(akhil);

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: /delete my account/i }));
    await userEvent.click(screen.getByRole("button", { name: /keep my account/i }));

    expect(screen.getByRole("button", { name: /delete my account/i })).toBeInTheDocument();
  });

  it("deletes the account and leaves the handler at sign in", async () => {
    signedInAs(akhil);
    let asked = false;
    server.use(
      http.delete("http://localhost:8000/me", () => {
        asked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: /delete my account/i }));
    await userEvent.click(screen.getByRole("button", { name: /yes, delete everything/i }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(asked).toBe(true);
  });

  it("signs out from the account screen", async () => {
    signedInAs(akhil);
    let asked = false;
    server.use(
      http.post("http://localhost:8000/auth/signout", () => {
        asked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderRoute("/account");
    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(asked).toBe(true);
  });
});
