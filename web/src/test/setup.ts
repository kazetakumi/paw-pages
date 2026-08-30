import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

// jsdom has no matchMedia. Drive it off window.innerWidth so a test can set the
// viewport width and the app picks the layout it would pick in a browser.
window.matchMedia = (query: string): MediaQueryList => {
  const min = /min-width:\s*(\d+)px/.exec(query);
  const matches = min ? window.innerWidth >= Number(min[1]) : false;
  return {
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
};

export function setViewportWidth(width: number) {
  window.innerWidth = width;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  window.innerWidth = 1024;
});
afterAll(() => server.close());
