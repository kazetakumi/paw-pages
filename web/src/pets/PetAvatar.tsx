import { useState } from "react";
import { photoUrl, publicPhotoUrl, type Pet, type PublicPet } from "../api";
import { initial } from "./pet";

/** The pet, as itself or as its letter.
 *
 *  The `src` is our own API, never Supabase: the bucket is private and the
 *  backend reads the object with the handler's token here and as `anon` on the
 *  public page. That is why an image and the page it sits on go dark together,
 *  and why removing a photo leaves the letter behind with nothing else to do.
 *  A photo that fails to load falls back to the letter too, not a broken image.
 */
export function PetAvatar({ pet, tint = "" }: { pet: Pet; tint?: string }) {
  return <Avatar name={pet.name} src={pet.has_photo ? photoUrl(pet.id) : null} tint={tint} />;
}

/** The same, for a visitor: keyed on the slug, because the public page is
 *  never told a pet's id. */
export function PublicPetAvatar({ pet }: { pet: PublicPet }) {
  return <Avatar name={pet.name} src={pet.has_photo ? publicPhotoUrl(pet.slug) : null} />;
}

function Avatar({ name, src, tint = "" }: { name: string; src: string | null; tint?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? (
    <img className="av" src={src} alt={name} onError={() => setFailed(src)} />
  ) : (
    <span className={`av ${tint}`.trimEnd()} aria-hidden="true">
      {initial(name)}
    </span>
  );
}
