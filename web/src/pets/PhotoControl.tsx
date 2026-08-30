import { useState, type ChangeEvent } from "react";
import { FieldError, removePhoto, uploadPhoto, type Pet } from "../api";
import { useIsDesktop } from "../shell/useIsDesktop";

/** The bucket's own allowed types, so the file picker offers what it will take. */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const HINT = "JPEG, PNG, WebP or HEIC, up to 5 MB.";

const INPUT = "photo";

/** Choose a photo, replace it, or take it away. One per pet, no gallery.
 *
 *  A bad picture is never permanent: the same control that put one there takes
 *  it away, and the backend deletes the object rather than only the path.
 */
export function PhotoControl({ pet, onChanged }: { pet: Pet; onChanged: (pet: Pet) => void }) {
  const [error, setError] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  async function chosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      onChanged(await uploadPhoto(pet.id, file));
    } catch (problem) {
      // The bucket's limits reach the handler as a message beside the picker.
      setError(problem instanceof FieldError ? problem.message : "That photo could not be saved.");
    }
  }

  const label = (
    <label className="k" htmlFor={INPUT}>
      Photo
    </label>
  );
  const picker = (
    <input
      id={INPUT}
      className="file"
      type="file"
      accept={ACCEPT}
      {...(error ? { "aria-invalid": true, "aria-describedby": `${INPUT}-problem` } : {})}
      onChange={chosen}
    />
  );
  const remove = pet.has_photo ? (
    <button className="rm" type="button" onClick={() => removePhoto(pet.id).then(onChanged)}>
      Remove photo
    </button>
  ) : null;
  const refusal = error ? (
    <p className="problem" id={`${INPUT}-problem`}>
      {error}
    </p>
  ) : null;

  /** Above the breakpoint: a label column, like every other row on this tab. */
  if (isDesktop) {
    return (
      <div className="card photo" data-photo="desktop">
        <div className="row">
          {label}
          <span className="v">
            {picker}
            {remove}
            <span className="hint">{HINT}</span>
            {refusal}
          </span>
        </div>
      </div>
    );
  }

  /** Below it: the label on top and the picker across the width under it. */
  return (
    <div className="card photo" data-photo="mobile">
      {label}
      <p className="hint">{HINT}</p>
      {picker}
      {remove}
      {refusal}
    </div>
  );
}
