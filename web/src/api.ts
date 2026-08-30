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

/** A pet as the API returns it. `age_*` is derived from the date of birth on
 *  every read and never stored, so the screen only ever formats what it got. */
export type Pet = {
  id: string;
  name: string;
  species: string;
  breed: string | null;
  sex: "male" | "female" | null;
  date_of_birth: string | null;
  dob_is_approx: boolean;
  colour: string | null;
  slug: string;
  /** Off until the handler throws the switch. The slug above is claimed at
   *  insert either way, so switching off and on again keeps the same URL. */
  is_public: boolean;
  age_years: number | null;
  age_months: number | null;
};

export type PetFields = Omit<Pet, "id" | "slug" | "is_public" | "age_years" | "age_months">;

export const listPets = () => request<Pet[]>("GET", "/pets");

export const getPet = (id: string) => request<PetRecord>("GET", `/pets/${id}`);

export const createPet = (fields: PetFields) => request<Pet>("POST", "/pets", fields);

export const updatePet = (id: string, fields: PetFields) =>
  request<Pet>("PATCH", `/pets/${id}`, fields);

/** The public-page switch. Its own call, because publishing a pet is not a
 *  correction to one and the identity form has no business carrying it. */
export const setPetPublic = (id: string, isPublic: boolean) =>
  request<Pet>("PATCH", `/pets/${id}`, { is_public: isPublic });

/** An entry as the API returns it. `is_overdue` is computed by the database in
 *  the `due_items` view — nothing here works out what overdue means. */
export type Entry = {
  id: string;
  pet_id: string;
  title: string;
  happened_on: string;
  due_on: string | null;
  vet: string | null;
  note: string | null;
  is_overdue: boolean;
};

export type EntryFields = Omit<Entry, "id" | "is_overdue">;

/** One page of a pet's feed. The cursor is opaque: carried back untouched. */
export type FeedPage = { entries: Entry[]; next_cursor: string | null };

export const listEntries = (petId: string, cursor?: string | null) =>
  request<FeedPage>(
    "GET",
    `/pets/${petId}/entries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );

/** `closesEntryId` is "log the next one": the API saves the new entry and
 *  closes that entry's due date in the one request. */
export const createEntry = (fields: EntryFields, closesEntryId?: string) =>
  request<Entry>("POST", "/entries", { ...fields, closes_entry_id: closesEntryId ?? null });

export const updateEntry = (id: string, fields: EntryFields) =>
  request<Entry>("PATCH", `/entries/${id}`, fields);

export const deleteEntry = (id: string) => send("DELETE", `/entries/${id}`);

export const recentTitles = () => request<string[]>("GET", "/entry-titles/recent");

/** One outstanding due date, straight off the `due_items` view. `days_until`
 *  and `is_overdue` are the database's answer — nothing here works out what
 *  overdue means, and a negative `days_until` is how far past it is. */
export type DueItem = {
  entry_id: string;
  pet_id: string;
  pet_name: string;
  title: string;
  due_on: string;
  days_until: number;
  is_overdue: boolean;
  happened_on: string;
  vet: string | null;
};

/** A pet with what it needs, so its page and the home ledger read one view. */
export type PetRecord = Pet & { due_items: DueItem[] };

export type PetCard = Pet & {
  next_due_on: string | null;
  next_due_is_overdue: boolean;
  last_logged_on: string | null;
};

/** The whole home screen in one response: the ledger, the cards and the counts. */
export type Dashboard = {
  ledger: DueItem[];
  pets: PetCard[];
  active_pets: number;
  overdue: number;
  due_within_30_days: number;
  archived_pets: number;
};

export const getDashboard = () => request<Dashboard>("GET", "/dashboard");

/** Dealt with elsewhere: the item leaves the ledger, the entry stays. */
export const markDone = (entryId: string) =>
  request<Entry>("POST", `/entries/${entryId}/mark-done`);

/** One line of a public record. No note, no vet, no id: the API never sends
 *  them, and no is_overdue either — the public page makes no accusation. */
export type PublicEntry = { title: string; happened_on: string; due_on: string | null };

/** A pet as a visitor holding the link sees it. `born` is already coarsened to
 *  a month and a year by the database; the exact date never leaves it. */
export type PublicPet = {
  slug: string;
  name: string;
  species: string;
  breed: string | null;
  colour: string | null;
  sex: string | null;
  born: string | null;
  age_years: number | null;
  age_months: number | null;
  updated_on: string;
  entries: PublicEntry[];
};

export const getPublicPage = (slug: string) =>
  request<PublicPet>("GET", `/public/pets/${slug}`);
