import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getMe, Unauthorized, type Handler } from "../api";
import { Shell } from "../shell/Shell";

export default function Home() {
  const [handler, setHandler] = useState<Handler | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    getMe()
      .then(setHandler)
      .catch((error) => {
        if (error instanceof Unauthorized) setSignedOut(true);
        else throw error;
      });
  }, []);

  if (signedOut) return <Navigate to="/signin" replace />;
  if (!handler) return null;

  return (
    <Shell name={handler.name}>
      <h1 className="greeting">Hello, {handler.name}</h1>
      <p className="greeting-sub">Your record is empty — pets arrive in the next slice.</p>
    </Shell>
  );
}
