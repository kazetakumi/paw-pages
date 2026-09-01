import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPet, getMe, Unauthorized, type Handler } from "../api";
import { PetForm } from "../pets/PetForm";
import { Shell } from "../shell/Shell";
import "../pets/pets.css";

/** No drawn screen of its own: the form sits on the same paper as every other
 *  signed-in screen, and the shell picks the layout. */
export default function PetNew() {
  const navigate = useNavigate();
  const [handler, setHandler] = useState<Handler | null>(null);

  useEffect(() => {
    // A 401 is the app's business, not this screen's: see App.tsx.
    getMe()
      .then(setHandler)
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, []);

  if (!handler) return null;

  return (
    <Shell name={handler.name} width="form">
      <div className="about">
        <Link className="back" to="/home">
          &larr; Home
        </Link>
        <h1 className="greeting">Add a pet</h1>
        <p className="lede">
          A name and a species are enough. Everything else can wait until you know it.
        </p>
        <PetForm
          submit="Add pet"
          save={createPet}
          onSaved={(pet) => navigate(`/pets/${pet.id}/about`)}
          onCancel={() => navigate("/home")}
        />
      </div>
    </Shell>
  );
}
