import { Navigate, Route, Routes } from "react-router-dom";
import Home from "./routes/home";
import SignIn from "./routes/signin";
import SignUp from "./routes/signup";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<Home />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
    </Routes>
  );
}
