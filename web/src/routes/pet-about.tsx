import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getMe, getPet, Unauthorized, type Handler, type Pet } from "../api";
import { ageOf, capitalised, formatDate, summaryOf } from "../pets/pet";
import { ArchivePanel } from "../pets/ArchivePanel";
import { PetAvatar } from "../pets/PetAvatar";
import { PetHeadSkeleton } from "../pets/PetHeadSkeleton";
import { PhotoControl } from "../pets/PhotoControl";
import { PublicPageSwitch } from "../pets/PublicPageSwitch";
import { Shell } from "../shell/Shell";
import { Bone } from "../shell/Skeleton";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../pets/pets.css";
import "../pets/pet-profile.css";

function Value({ text }: { text: string | null }) {
  return text ? <span className="v">{text}</span> : <span className="v empty">Not recorded</span>;
}

/** The pet's own header: avatar, name, the breed/sex/age line. Correcting any
 *  of it now happens in chat, not on a form here. */
function Phead({ pet }: { pet: Pet }) {
  const isDesktop = useIsDesktop();
  const cta = (
    <Link className="btn" to="/home?new=1">
      Edit in chat
    </Link>
  );
  return isDesktop ? (
    <div className="phead">
      <PetAvatar pet={pet} />
      <div className="id">
        <h1>{pet.name}</h1>
        <div className="meta">{summaryOf(pet)}</div>
      </div>
      <div className="pacts">{cta}</div>
    </div>
  ) : (
    <div className="phead">
      <div className="phead-top">
        <PetAvatar pet={pet} />
        <div>
          <h1>{pet.name}</h1>
          <div className="meta">{summaryOf(pet)}</div>
        </div>
      </div>
      {cta}
    </div>
  );
}

export default function PetAbout() {
  const { id = "" } = useParams();
  const [record, setRecord] = useState<{ handler: Handler; pet: Pet } | null>(null);

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    Promise.all([getMe(), getPet(id)])
      .then(([handler, pet]) => setRecord({ handler, pet }))
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, [id]);

  if (!record) {
    return (
      <Shell name="" credits={null} title="" width="pet">
        <PetHeadSkeleton tab="About" />
        <div className="sect">
          <h2>Identity</h2>
          <span className="line" />
        </div>
        <div className="card ident">
          {["Species", "Breed", "Sex", "Date of birth", "Colour"].map((label) => (
            <div className="row" key={label}>
              <span className="k">{label}</span>
              <Bone w={120} />
            </div>
          ))}
        </div>
      </Shell>
    );
  }
  const { handler, pet } = record;
  const onChanged = (saved: Pet) => setRecord({ handler, pet: saved });

  return (
    <Shell name={handler.name} credits={handler.credits} title={pet.name} width="pet">
      <Link className="back" to="/dashboard">
        &larr; Dashboard
      </Link>
      <Phead pet={pet} />

      <nav className="tabs" aria-label="Pet">
        <Link className="tab" to={`/pets/${pet.id}`}>
          Feed
        </Link>
        <span className="tab on">About</span>
      </nav>

      <div className="sect">
        <h2>Identity</h2>
        <span className="line" />
      </div>
      <div className="card ident">
        <div className="row">
          <span className="k">Species</span>
          <Value text={pet.species} />
        </div>
        <div className="row">
          <span className="k">Breed</span>
          <Value text={pet.breed} />
        </div>
        <div className="row">
          <span className="k">Sex</span>
          <Value text={capitalised(pet.sex)} />
        </div>
        <div className="row">
          <span className="k">Date of birth</span>
          {pet.date_of_birth ? (
            <span className="v mono">
              {formatDate(pet.date_of_birth)}
              {pet.dob_is_approx && <span className="approx">approx.</span>}
              <span className="derived">{ageOf(pet)}</span>
            </span>
          ) : (
            <Value text={null} />
          )}
        </div>
        <div className="row">
          <span className="k">Colour</span>
          <Value text={pet.colour} />
        </div>
        <PhotoControl pet={pet} onChanged={onChanged} />
      </div>

      <div className="sect apart">
        <h2>Public page</h2>
        <span className="line" />
      </div>
      <PublicPageSwitch pet={pet} onChanged={onChanged} />

      <div className="sect apart">
        <h2>Archive</h2>
        <span className="line" />
      </div>
      <ArchivePanel pet={pet} />
    </Shell>
  );
}
