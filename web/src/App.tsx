import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { onSessionLost } from "./api";
import ForgotPassword from "./routes/forgot-password";
import Home from "./routes/home";
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
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Routes>
    </>
  );
}
