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
  // A File goes up as itself under its own type, because that is what the
  // photo routes take and what the bucket's allowed types are checked against.
  const file = body instanceof File ? body : null;
  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers:
      body === undefined
        ? undefined
        : { "Content-Type": file ? file.type : "application/json" },
    body: body === undefined ? undefined : (file ?? JSON.stringify(body)),
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

/** The handler, as the account screen reads them. `age` is derived from the
 *  date of birth by the database on every read and never stored, so the screen
 *  only ever shows the number it was given. The email lives in Supabase Auth
 *  and reaches us through the session, never through the handlers table. */
export type Handler = {
  id: string;
  name: string;
  email: string;
  joined_on: string;
  pet_count: number;
  entry_count: number;
  /** The three optional ones. Null until the handler fills them in, and
   *  nothing in the app branches on any of them. */
  date_of_birth: string | null;
  gender: string | null;
  nationality: string | null;
  age: number | null;
};

export type HandlerFields = Pick<
  Handler,
  "name" | "date_of_birth" | "gender" | "nationality"
>;

export const getMe = () => request<Handler>("GET", "/me");

/** Is anyone signed in? Asked at the root, where a 401 is the expected answer
 *  for a visitor rather than a session that ran out — so this one asks the
 *  API directly and never sends anybody to sign in. */
export async function hasSession(): Promise<boolean> {
  return (await fetch(BASE + "/me", { credentials: "include" })).ok;
}

/** Only the fields sent are touched; null clears one back to unset. */
export const updateMe = (fields: Partial<HandlerFields>) =>
  request<Handler>("PATCH", "/me", fields);

/** The email and the password each have their own endpoint, because each is a
 *  credential Supabase Auth owns rather than a column on the handler. */
export const updateEmail = (email: string) =>
  request<Handler>("PATCH", "/me/email", { email });

export const updatePassword = (password: string) =>
  send("PATCH", "/me/password", { password });

/** One archive, built on request and streamed by the API. A plain link, so the
 *  browser saves the file itself and nothing is ever held in memory here. */
export const exportUrl = () => `${BASE}/me/export`;

/** Photos first, then the auth user, which cascades the rows. All of that is
 *  the backend's ordering to keep; this only asks. */
export const deleteAccount = () => send("DELETE", "/me");

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
  /** Whether there is a photo to ask `photoUrl` for. Never the path: the
   *  object lives in a private bucket the browser cannot name. */
  has_photo: boolean;
  age_years: number | null;
  age_months: number | null;
};

export type PetFields = Omit<
  Pet,
  "id" | "slug" | "is_public" | "has_photo" | "age_years" | "age_months"
>;

export const listPets = () => request<Pet[]>("GET", "/pets");

export const getPet = (id: string) => request<PetRecord>("GET", `/pets/${id}`);

export const createPet = (fields: PetFields) => request<Pet>("POST", "/pets", fields);

export const updatePet = (id: string, fields: PetFields) =>
  request<Pet>("PATCH", `/pets/${id}`, fields);

/** Why a pet was archived. The three the database's check allows, and no
 *  fourth: there is no archiving without saying which. */
export type ArchiveReason = "passed_away" | "rehomed" | "other";

/** An archived pet as the home screen keeps it — findable, out of the way. */
export type ArchivedPet = {
  id: string;
  name: string;
  archived_reason: ArchiveReason;
  archived_on: string;
};

/** Archiving sets two columns and nothing else. The ledger, the public page
 *  and the photo all stop seeing the pet because the database's views exclude
 *  it — nothing here filters an archived pet out of anything. */
export const archivePet = (id: string, reason: ArchiveReason) =>
  request<Pet>("POST", `/pets/${id}/archive`, { reason });

export const restorePet = (id: string) => request<Pet>("POST", `/pets/${id}/restore`);

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
  archived: ArchivedPet[];
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
  has_photo: boolean;
  updated_on: string;
  entries: PublicEntry[];
};

export const getPublicPage = (slug: string) =>
  request<PublicPet>("GET", `/public/pets/${slug}`);

/** Where the bytes come from: our own API, out of a private bucket. No signed
 *  URL and no Supabase domain ever reaches the browser — the backend reads the
 *  object with the handler's token here and as `anon` below, so an image stops
 *  resolving at the same instant the page it belongs to goes dark. */
export const photoUrl = (petId: string) => `${BASE}/pets/${petId}/photo`;
export const publicPhotoUrl = (slug: string) => `${BASE}/public/pets/${slug}/photo`;

export const uploadPhoto = (petId: string, file: File) =>
  request<Pet>("PUT", `/pets/${petId}/photo`, file);

export const removePhoto = (petId: string) => request<Pet>("DELETE", `/pets/${petId}/photo`);
