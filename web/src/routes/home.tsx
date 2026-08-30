import { useEffect, useState } from "react";
import { getMe, Unauthorized, type Handler } from "../api";
import { Shell } from "../shell/Shell";

export default function Home() {
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
    <Shell name={handler.name}>
      <h1 className="greeting">Hello, {handler.name}</h1>
      <p className="greeting-sub">
        Your record is empty — pets arrive in the next slice.
      </p>
    </Shell>
  );
}
