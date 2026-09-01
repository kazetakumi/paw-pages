import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useIsDesktop } from "./useIsDesktop";
import "./shell.css";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/** The drawn column width per screen. The dashboard is the widest; the log form
 *  is the narrowest. Anything wider than its drawing reads as a broken page. */
export type PageWidth = "wide" | "pet" | "account" | "form";

function ShellDesktop({
  name,
  width,
  children,
}: {
  name: string;
  width: PageWidth;
  children: ReactNode;
}) {
  return (
    <div className="shell-desktop" data-layout="desktop">
      <header className="topbar">
        <div className="in">
          <Link className="wordmark" to="/home">
            Paw<span className="p2">Pages</span>
          </Link>
          <nav className="topnav" aria-label="Main">
            <Link className="on" to="/home">
              Home
            </Link>
            <Link to="/home">Pets</Link>
            <Link to="/account">Account</Link>
          </nav>
          <div className="who">
            <span className="chip">{initials(name)}</span>
            {name}
          </div>
        </div>
      </header>
      <main className="page" data-width={width}>
        {children}
      </main>
    </div>
  );
}

function ShellMobile({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="shell-mobile" data-layout="mobile">
      <div className="top">
        <span className="wordmark">
          Paw<span className="p2">Pages</span>
        </span>
        <Link className="acct" to="/account" aria-label="Account">
          <span className="chip">{initials(name)}</span>
        </Link>
      </div>
      <main className="scroll">{children}</main>
    </div>
  );
}

export function Shell({
  name,
  width = "wide",
  children,
}: {
  name: string;
  width?: PageWidth;
  children: ReactNode;
}) {
  return useIsDesktop() ? (
    <ShellDesktop name={name} width={width}>
      {children}
    </ShellDesktop>
  ) : (
    <ShellMobile name={name}>{children}</ShellMobile>
  );
}
