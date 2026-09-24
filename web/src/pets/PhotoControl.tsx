import { useState, type ChangeEvent } from "react";
import { FieldError, removePhoto, uploadPhoto, type Pet } from "../api";

/** The bucket's own allowed types, so the file picker offers what it will take. */
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";
const HINT = "JPEG, PNG, WebP or HEIC, up to 5 MB.";

const INPUT = "photo";

/** Choose a photo, replace it, or take it away. One per pet, no gallery, and
 *  no mock of its own — it rides along as the last row on the identity card,
 *  right where the rest of the pet's own facts are.
 *
 *  A bad picture is never permanent: the same control that put one there takes
 *  it away, and the backend deletes the object rather than only the path.
 */
export function PhotoControl({ pet, onChanged }: { pet: Pet; onChanged: (pet: Pet) => void }) {
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="row photo">
      <label className="k" htmlFor={INPUT}>
        Photo
      </label>
      <span className="v">
        <input
          id={INPUT}
          className="file"
          type="file"
          accept={ACCEPT}
          {...(error ? { "aria-invalid": true, "aria-describedby": `${INPUT}-problem` } : {})}
          onChange={chosen}
        />
        {pet.has_photo && (
          <button className="rm" type="button" onClick={() => removePhoto(pet.id).then(onChanged)}>
            Remove photo
          </button>
        )}
        <span className="hint">{HINT}</span>
        {error && (
          <p className="problem" id={`${INPUT}-problem`}>
            {error}
          </p>
        )}
      </span>
    </div>
  );
}
