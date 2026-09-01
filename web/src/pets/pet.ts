import type { Pet } from "../api";

export const initial = (name: string) => name.trim().charAt(0).toUpperCase();

/** The age the API derived, in words. Never computed here. */
export function ageOf(pet: Pet): string | null {
  const { age_years: years, age_months: months } = pet;
  if (years === null || months === null) return null;
  const yrs = `${years} ${years === 1 ? "yr" : "yrs"}`;
  if (years === 0) return `${months} mo`;
  return months === 0 ? yrs : `${yrs} ${months} mo`;
}

/** A stored value shown at the head of its own row. The line under the pet's
 *  name keeps the value as written; only the identity row is capitalised. */
export const capitalised = (value: string | null) =>
  value ? value[0]!.toUpperCase() + value.slice(1) : value;

/** Breed, sex and age — whichever of them this pet actually has. */
export const summaryOf = (pet: Pet) =>
  [pet.breed || pet.species, pet.sex, ageOf(pet)].filter(Boolean).join(" · ");

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** A calendar date, formatted as it was given. No Date, so no timezone can
 *  shift it a day either way. */
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/** The same date without the year, where the narrow layout has no room. */
export const formatDayMonth = (date: string) => formatDate(date).slice(0, -5);
