import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { onSessionLost } from "./api";
import Account from "./routes/account";
import Dashboard from "./routes/dashboard";
import ForgotPassword from "./routes/forgot-password";
import Home from "./routes/home";
import Landing from "./routes/landing";
import PetAbout from "./routes/pet-about";
import PetFeed from "./routes/pet-feed";
import PublicPage from "./routes/public-page";
import ResetPassword from "./routes/reset-password";
import SignIn from "./routes/signin";
import SignUp from "./routes/signup";

/** One way out of a session that has run out, wherever in the app it runs out. */
function SignInOnUnauthorized() {
  const navigate = useNavigate();
  useEffect(() => {
    onSessionLost(() => navigate("/signin", { replace: true }));
    return () => onSessionLost(null);
  }, [navigate]);
  return null;
}

export function AppRoutes() {
  return (
    <>
      <SignInOnUnauthorized />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/home" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/account" element={<Account />} />
        <Route path="/pets/:id" element={<PetFeed />} />
        <Route path="/pets/:id/about" element={<PetAbout />} />
        {/* No account, no cookie, no Shell: a document a visitor was handed. */}
        <Route path="/p/:slug" element={<PublicPage />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </>
  );
}
