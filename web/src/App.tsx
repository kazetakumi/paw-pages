import { Navigate, Route, Routes } from "react-router-dom";
import ForgotPassword from "./routes/forgot-password";
import Home from "./routes/home";
import ResetPassword from "./routes/reset-password";
import SignIn from "./routes/signin";
import SignUp from "./routes/signup";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<Home />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>
  );
}
