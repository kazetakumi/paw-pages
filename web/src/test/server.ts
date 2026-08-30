import { setupServer } from "msw/node";

// No default handlers: every test declares the HTTP it expects, and anything
// unhandled fails loudly.
export const server = setupServer();
