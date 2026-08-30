const BASE = import.meta.env.VITE_API_URL ?? "/api";

export class Unauthorized extends Error {}

export class ApiError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
  }
}

/** A 4xx the API pinned to one field, so the screen can show it beside that field. */
export class FieldError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

let sessionLost: (() => void) | null = null;

/** Called when an authenticated call comes back 401, from anywhere in the app. */
export function onSessionLost(handler: (() => void) | null) {
  sessionLost = handler;
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // A 401 from /auth/* is a rejected credential, not a session that ran out.
  if (res.status === 401 && !path.startsWith("/auth/")) {
    sessionLost?.();
    throw new Unauthorized();
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.detail;
    if (detail && typeof detail === "object" && "field" in detail) {
      throw new FieldError(detail.field, detail.message);
    }
    throw new ApiError(typeof detail === "string" ? detail : "Something went wrong.");
  }
  return res;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await call(method, path, body)).json()) as T;
}

async function send(method: string, path: string, body?: unknown): Promise<void> {
  await call(method, path, body);
}

export type Handler = { id: string; name: string };

export const getMe = () => request<Handler>("GET", "/me");

export const signUp = (name: string, email: string, password: string) =>
  request<Handler>("POST", "/auth/signup", { name, email, password });

export const signIn = (email: string, password: string) =>
  request<Handler>("POST", "/auth/signin", { email, password });

export const signOut = () => send("POST", "/auth/signout");

export const requestPasswordReset = (email: string) =>
  send("POST", "/auth/password-reset", { email });

export const confirmPasswordReset = (accessToken: string, password: string) =>
  send("POST", "/auth/password-reset/confirm", { access_token: accessToken, password });
