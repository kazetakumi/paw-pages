import { photoUrl, publicPhotoUrl, type Pet, type PublicPet } from "../api";
import { initial } from "./pet";

/** The pet, as itself or as its letter.
 *
 *  The `src` is our own API, never Supabase: the bucket is private and the
 *  backend reads the object with the handler's token here and as `anon` on the
 *  public page. That is why an image and the page it sits on go dark together,
 *  and why removing a photo leaves the letter behind with nothing else to do.
 */
export function PetAvatar({ pet, tint = "" }: { pet: Pet; tint?: string }) {
  return pet.has_photo ? (
    <img className="av" src={photoUrl(pet.id)} alt={pet.name} />
  ) : (
    <span className={`av ${tint}`.trimEnd()} aria-hidden="true">
      {initial(pet.name)}
    </span>
  );
}

/** The same, for a visitor: keyed on the slug, because the public page is
 *  never told a pet's id. */
export function PublicPetAvatar({ pet }: { pet: PublicPet }) {
  return pet.has_photo ? (
    <img className="av" src={publicPhotoUrl(pet.slug)} alt={pet.name} />
  ) : (
    <span className="av" aria-hidden="true">
      {initial(pet.name)}
    </span>
  );
}
