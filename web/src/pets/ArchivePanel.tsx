import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { archivePet, type ArchiveReason, type Pet } from "../api";
import { useIsDesktop } from "../shell/useIsDesktop";

/** The three the database's check allows, worded the way a handler would. */
const REASONS: { value: ArchiveReason; label: string }[] = [
  { value: "passed_away", label: "Passed away" },
  { value: "rehomed", label: "Rehomed" },
  { value: "other", label: "Something else" },
];

const PRONOUNS = {
  male: { them: "him", their: "his" },
  female: { them: "her", their: "her" },
  unknown: { them: "them", their: "their" },
};

/** Archive a pet, with what that costs said out loud first.
 *
 *  Every consequence is stated before the button is pressed rather than after,
 *  because a handler reaching this panel has usually just lost a pet and this
 *  is the worst possible moment to be surprised by any of it.
 */
export function ArchivePanel({ pet }: { pet: Pet }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<ArchiveReason | null>(null);
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { them, their } = PRONOUNS[pet.sex ?? "unknown"];

  const consequences = (
    <p className="says">
      Archiving keeps <b>{pet.name}&rsquo;s history and photo</b>, hides {them} from your home
      screen, stops {their} due dates counting, and takes {their} public page offline. You can
      undo it any time.
    </p>
  );

  const choices = REASONS.map(({ value, label }) => (
    <label className="why" key={value}>
      <input
        type="radio"
        name="archive-reason"
        value={value}
        checked={reason === value}
        onChange={() => setReason(value)}
      />
      {label}
    </label>
  ));

  const confirm = (
    <button
      className="a"
      type="button"
      disabled={reason === null}
      onClick={() => {
        // The pet leaves the home screen the moment this returns, so that is
        // where the handler is put — beside the count it has become.
        archivePet(pet.id, reason!).then(() => navigate("/home"));
      }}
    >
      Archive
    </button>
  );

  const back = (
    <button className="keep" type="button" onClick={() => setConfirming(false)}>
      Keep {pet.name}
    </button>
  );

  const open = (
    <button className="a" type="button" onClick={() => setConfirming(true)}>
      Archive {pet.name}
    </button>
  );

  /** Above the breakpoint: the reasons across one row, the two acts beside them. */
  if (isDesktop) {
    return (
      <div className="arch" data-archive="desktop" role="region" aria-label="Archive">
        <h3>No longer with you?</h3>
        {consequences}
        {confirming ? (
          <>
            <fieldset className="whys row">
              <legend>Why?</legend>
              {choices}
            </fieldset>
            <div className="acts">
              {confirm}
              {back}
            </div>
          </>
        ) : (
          open
        )}
      </div>
    );
  }

  /** Below it: the reasons stacked, every control the full width of the card. */
  return (
    <div className="arch" data-archive="mobile" role="region" aria-label="Archive">
      <h3>No longer with you?</h3>
      {consequences}
      {confirming ? (
        <>
          <fieldset className="whys">
            <legend>Why?</legend>
            {choices}
          </fieldset>
          {confirm}
          {back}
        </>
      ) : (
        open
      )}
    </div>
  );
}
