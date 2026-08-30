import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useIsDesktop } from "../shell/useIsDesktop";
import "./auth.css";

// Both drawn layouts hang the same sheet on the same paper; the frame around it
// is what differs — centred in a wide field above the breakpoint, one
// full-height column below it.
function AuthDesktop({ children }: { children: ReactNode }) {
  return (
    <div className="auth" data-layout="desktop">
      <div className="device">
        <Link className="mark" to="/">
          Paw<span className="p2">Pages</span>
        </Link>
        {children}
      </div>
    </div>
  );
}

function AuthMobile({ children }: { children: ReactNode }) {
  return (
    <div className="auth" data-layout="mobile">
      <div className="device">
        <Link className="mark" to="/">
          Paw<span className="p2">Pages</span>
        </Link>
        {children}
      </div>
    </div>
  );
}

export function AuthScreen({ children }: { children: ReactNode }) {
  const Layout = useIsDesktop() ? AuthDesktop : AuthMobile;
  return <Layout>{children}</Layout>;
}
