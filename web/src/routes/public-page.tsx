import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getPublicPage,
  publicEntryPhotoUrl,
  type PublicEntry,
  type PublicPet,
} from "../api";
import { formatDate } from "../pets/pet";
import { PublicPetAvatar } from "../pets/PetAvatar";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/public.css";

/** The age the API derived, in words. Never computed here. */
function ageOf(pet: PublicPet): string | null {
  const { age_years: years, age_months: months } = pet;
  if (years === null || months === null) return null;
  const yrs = `${years} ${years === 1 ? "yr" : "yrs"}`;
  if (years === 0) return `${months} mo`;
  return months === 0 ? yrs : `${yrs} ${months} mo`;
}

const dot = (
  <span className="dot" aria-hidden="true">
    ·
  </span>
);

/** Breed, sex and — on the wide layout only — age, whichever this pet has. */
function Meta({ parts }: { parts: (string | null)[] }) {
  const shown = parts.filter(Boolean);
  return (
    <div className="meta">
      {shown.map((part, at) => (
        <span key={part}>
          {at > 0 && dot}
          {part}
        </span>
      ))}
    </div>
  );
}

function Cell({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="cell">
      <span className="k">{k}</span>
      <span className="v">{v ?? "—"}</span>
    </div>
  );
}

/** One line of the record. A due date prints in the same neutral grey whatever
 *  its date: the public page never stamps an accusation on the handler, so it
 *  does not ask the API whether anything is overdue and is not told. */
function Record({ entries, slug }: { entries: PublicEntry[]; slug: string }) {
  return (
    <div className="rec">
      {entries.map((entry) => (
        <div className="r" key={`${entry.happened_on}-${entry.title}`}>
          <span className="d">{formatDate(entry.happened_on)}</span>
          <span className="w">{entry.title}</span>
          {entry.due_on ? <span className="nx">Next {formatDate(entry.due_on)}</span> : <span />}
          {/* The proof, when the handler published one. Read as `anon` out
              of the same private bucket — a link, never a Supabase URL. */}
          {entry.photo_id && (
            <img
              className="pf"
              src={publicEntryPhotoUrl(slug, entry.photo_id)}
              alt={`${entry.title}, ${formatDate(entry.happened_on)}`}
              loading="lazy"
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Footer({ pet }: { pet: PublicPet }) {
  return (
    <div className="foot">
      <span className="up">Last updated {formatDate(pet.updated_on)}</span>
      <span className="mk">
        Paw<span className="p2">Pages</span>
      </span>
    </div>
  );
}

/** Unsigned on purpose: the pet's name, never the handler's. */
function Under({ pet }: { pet: PublicPet }) {
  return (
    <p className="under">
      Shared by {pet.name}&rsquo;s owner. Notes, contact details and clinic names are not shown.
    </p>
  );
}

/** Above the breakpoint: the age sits in the line under the name, and the
 *  facts strip runs four across. */
function PageDesktop({ pet }: { pet: PublicPet }) {
  return (
    <div className="pubpage" data-layout="desktop">
      <div className="doc">
        <div className="kicker">Pet record</div>
        <div className="idblock">
          <PublicPetAvatar pet={pet} />
          <div>
            <h1>{pet.name}</h1>
            <Meta parts={[pet.breed || pet.species, pet.sex, ageOf(pet)]} />
          </div>
        </div>

        <div className="strip">
          <Cell k="Species" v={pet.species} />
          <Cell k="Breed" v={pet.breed} />
          <Cell k="Colour" v={pet.colour} />
          <Cell k="Born" v={pet.born} />
        </div>

        <div className="recwrap">
          <div className="sect">
            <h2>Record</h2>
            <span className="line" />
            <span className="n">
              {pet.entries.length} {pet.entries.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <Record entries={pet.entries} slug={pet.slug} />
        </div>

        <Footer pet={pet} />
      </div>
      <Under pet={pet} />
    </div>
  );
}

/** Below it: the age moves into the facts strip, which runs two across, and
 *  each record line stacks. */
function PageMobile({ pet }: { pet: PublicPet }) {
  return (
    <div className="pubpage" data-layout="mobile">
      <div className="doc">
        <div className="kicker">Pet record</div>
        <div className="idblock">
          <PublicPetAvatar pet={pet} />
          <div>
            <h1>{pet.name}</h1>
            <Meta parts={[pet.breed || pet.species, pet.sex]} />
          </div>
        </div>

        <div className="strip">
          <Cell k="Species" v={pet.species} />
          <Cell k="Age" v={ageOf(pet)} />
          <Cell k="Colour" v={pet.colour} />
          <Cell k="Born" v={pet.born} />
        </div>

        <div className="recwrap">
          <div className="sect">
            <h2>Record</h2>
            <span className="line" />
            <span className="n">{pet.entries.length}</span>
          </div>
          <Record entries={pet.entries} slug={pet.slug} />
        </div>

        <Footer pet={pet} />
      </div>
      <Under pet={pet} />
    </div>
  );
}

/** A document, not an app screen: no Shell, so no navigation, no avatar and no
 *  sign-in prompt beyond the footer mark. */
export default function PublicPage() {
  const { slug = "" } = useParams();
  const [state, setState] = useState<PublicPet | "gone" | null>(null);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    getPublicPage(slug)
      .then(setState)
      .catch(() => setState("gone"));
  }, [slug]);

  if (state === null) return null;
  if (state === "gone") {
    // The one answer to a slug that is private, archived or absent alike.
    return (
      <div className="pubpage gone">
        <p>This page is not available.</p>
      </div>
    );
  }
  return isDesktop ? <PageDesktop pet={state} /> : <PageMobile pet={state} />;
}
