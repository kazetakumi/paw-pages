import { restorePet, type ArchivedPet } from "../api";
import { formatDate } from "./pet";
import { useIsDesktop } from "../shell/useIsDesktop";

/** The stored reason, in the words the confirm panel offered. */
const REASONS = {
  passed_away: "Passed away",
  rehomed: "Rehomed",
  other: "Something else",
};

/** The archived pets, named with why and when, and each one a tap from back.
 *
 *  They are here rather than among the cards because an archived pet owes
 *  nothing and needs nothing — but a rehoming that fell through, or a mistaken
 *  tap, should cost nothing either.
 */
export function ArchivedList({
  pets,
  onRestored,
}: {
  pets: ArchivedPet[];
  onRestored: () => void;
}) {
  const isDesktop = useIsDesktop();
  const restore = (pet: ArchivedPet) => restorePet(pet.id).then(onRestored);

  const undo = (pet: ArchivedPet) => (
    <button className="undo" type="button" onClick={() => restore(pet)}>
      Restore {pet.name}
    </button>
  );

  /** Above the breakpoint: a column each for the name, the reason and the
   *  date, so several archived pets line up and read down. */
  if (isDesktop) {
    return (
      <div className="arclist" data-archived="desktop" role="region" aria-label="Archived">
        {pets.map((pet) => (
          <div className="arow" key={pet.id}>
            <span className="nm">{pet.name}</span>
            <span className="why">{REASONS[pet.archived_reason]}</span>
            <span className="on">{formatDate(pet.archived_on)}</span>
            {undo(pet)}
          </div>
        ))}
      </div>
    );
  }

  /** Below it: the name on its own line, why and when together under it, and
   *  the control across the width rather than squeezed onto the row. */
  return (
    <div className="arclist" data-archived="mobile" role="region" aria-label="Archived">
      {pets.map((pet) => (
        <div className="arow" key={pet.id}>
          <span className="nm">{pet.name}</span>
          <span className="cap">
            <span className="why">{REASONS[pet.archived_reason]}</span>
            <i aria-hidden="true">·</i>
            <span className="on">{formatDate(pet.archived_on)}</span>
          </span>
          {undo(pet)}
        </div>
      ))}
    </div>
  );
}
