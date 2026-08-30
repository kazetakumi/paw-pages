import { useState } from "react";
import { setPetPublic, type Pet } from "../api";

/** The public URL as a visitor would type it, and as the browser would open it. */
const linkTo = (slug: string) => `${window.location.origin}/p/${slug}`;

export function PublicPageSwitch({
  pet,
  onChanged,
}: {
  pet: Pet;
  onChanged: (pet: Pet) => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = linkTo(pet.slug);

  return (
    <div className="pub">
      <div className="hd">
        <span className="st">
          {pet.name}&rsquo;s page is{" "}
          <span className={pet.is_public ? "on" : "off"}>{pet.is_public ? "live" : "off"}</span>
        </span>
        <button
          className="sw"
          type="button"
          role="switch"
          aria-checked={pet.is_public}
          aria-label="Public page"
          onClick={() => {
            setCopied(false);
            setPetPublic(pet.id, !pet.is_public).then(onChanged);
          }}
        />
      </div>

      {/* The link exists only while the page does. Switching off takes it away
          here at the same moment it starts 404ing for anyone holding it. */}
      {pet.is_public && (
        <div className="url">
          <span className="u">{url.replace(/^https?:\/\//, "")}</span>
          <button
            className="cp"
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}

      {/* Stated whether the page is on or off, so nobody throws the switch to
          find out what it does. */}
      <p className="shows">
        Anyone with this link sees <b>name, species, breed, colour and age</b>, and every
        entry&rsquo;s date and title.
        <br />
        <span className="no">
          Your name, contact details, notes and clinic names are never shown, and the date of
          birth shows only as a month and year.
        </span>
      </p>
    </div>
  );
}
