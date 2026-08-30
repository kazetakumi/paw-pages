import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "../test/server";
import { setViewportWidth } from "../test/setup";
import { renderRoute } from "../test/render";

describe("forgetting a password", () => {
  it("draws the desktop layout above the breakpoint", () => {
    setViewportWidth(1200);

    const { container } = renderRoute("/forgot-password");

    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeNull();
  });

  it("draws the mobile layout below the breakpoint", () => {
    setViewportWidth(390);

    const { container } = renderRoute("/forgot-password");

    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(container.querySelector('[data-layout="mobile"]')).toBeInTheDocument();
    expect(container.querySelector('[data-layout="desktop"]')).toBeNull();
  });

  it("asks the API to email a link and then says a link is on its way", async () => {
    const asked: unknown[] = [];
    server.use(
      http.post("http://localhost:8000/auth/password-reset", async ({ request }) => {
        asked.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderRoute("/forgot-password");
    await userEvent.type(screen.getByLabelText("Email"), "akhil@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Email me a link" }));

    expect(await screen.findByText(/on its way/i)).toBeInTheDocument();
    expect(asked).toEqual([{ email: "akhil@example.com" }]);
  });
});
