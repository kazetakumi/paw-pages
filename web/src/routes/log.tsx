import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { createEntry, getMe, listPets, Unauthorized, type Handler, type Pet } from "../api";
import { EntryForm } from "../entries/EntryForm";
import { Shell } from "../shell/Shell";
import "../pets/pets.css";
import "../entries/entries.css";

/** One form for everything worth remembering. The shell picks the layout;
 *  the form itself is arranged as drawn on either side of the breakpoint. */
export default function Log() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [loaded, setLoaded] = useState<{ handler: Handler; pets: Pet[] } | null>(null);

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    Promise.all([getMe(), listPets()])
      .then(([handler, pets]) => setLoaded({ handler, pets }))
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, []);

  if (!loaded) return null;
  const from = search.get("pet") ?? undefined;

  return (
    <Shell name={loaded.handler.name}>
      <div className="about">
        <Link className="back" to={from ? `/pets/${from}` : "/home"}>
          &larr; Back
        </Link>
        <h1 className="greeting">Log an entry</h1>
        <p className="lede">
          Anything worth remembering — a shot, a vet visit, a deworming tablet, a grooming
          appointment.
        </p>
        <EntryForm
          pets={loaded.pets}
          petId={from}
          save={createEntry}
          onSaved={(entry) => navigate(`/pets/${entry.pet_id}`)}
          onCancel={() => navigate(from ? `/pets/${from}` : "/home")}
        />
      </div>
    </Shell>
  );
}
