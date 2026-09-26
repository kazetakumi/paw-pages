import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useIsDesktop } from "../shell/useIsDesktop";
import "./auth.css";

// Both drawn layouts hang the same sheet on the same paper; the frame around it
// is what differs — centred in a wide field above the breakpoint, one
// full-height column below it.
function Brand() {
  return (
    <Link className="brand" to="/">
      <span className="brand-mark" aria-hidden="true">
        P
      </span>
      <span className="brand-word">
        Paw<span className="p2">Pages</span>
      </span>
    </Link>
  );
}

function AuthDesktop({ children }: { children: ReactNode }) {
  return (
    <div className="auth" data-layout="desktop">
      <div className="device">
        <Brand />
        {children}
      </div>
    </div>
  );
}

function AuthMobile({ children }: { children: ReactNode }) {
  return (
    <div className="auth" data-layout="mobile">
      <div className="device">
        <Brand />
        {children}
      </div>
    </div>
  );
}

export function AuthScreen({ children }: { children: ReactNode }) {
  const Layout = useIsDesktop() ? AuthDesktop : AuthMobile;
  return <Layout>{children}</Layout>;
}
