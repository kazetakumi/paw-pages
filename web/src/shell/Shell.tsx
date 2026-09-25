import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { listConversations, Unauthorized, type ConversationSummary } from "../api";
import { initials } from "./initials";
import { useIsDesktop } from "./useIsDesktop";
import "./shell.css";

/** The drawn column width per screen, from design/v2/*-web.html's own `.page`
 *  max-width. Anything wider than its drawing reads as a broken page. */
export type PageWidth = "wide" | "pet" | "account";

/** Buckets by `updated_at`, most recent group first -- the same two labels
 *  the design ships, plus "Older" so nothing falls off the list. */
function groupByRecency(
  conversations: ConversationSummary[],
): { group: string; items: ConversationSummary[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const today: ConversationSummary[] = [];
  const previous7Days: ConversationSummary[] = [];
  const older: ConversationSummary[] = [];
  for (const c of conversations) {
    const updatedAt = new Date(c.updated_at);
    if (updatedAt >= startOfToday) today.push(c);
    else if (updatedAt >= sevenDaysAgo) previous7Days.push(c);
    else older.push(c);
  }

  return [
    { group: "Today", items: today },
    { group: "Previous 7 days", items: previous7Days },
    { group: "Older", items: older },
  ].filter((g) => g.items.length > 0);
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 4.5v15M4.5 12h15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M19.4 13.5a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19.5a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H4.5a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H10.5a1.65 1.65 0 0 0 1-1.51V4.5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V10.5a1.65 1.65 0 0 0 1.51 1H19.5a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5h16v11H9.5L5 20v-3.5H4v-11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DashboardBtnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="7.5" height="7.5" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
      <rect x="13" y="4.5" width="7.5" height="15" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
      <rect x="3.5" y="14" width="7.5" height="5.5" rx="1.3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function SidebarToggleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9.5 4.5v15" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      P
    </span>
  );
}

export function BrandWord() {
  return (
    <span className="brand-word">
      Paw<span className="p2">Pages</span>
    </span>
  );
}

function NavRows({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <Link className="side-row" to="/home?new=1" onClick={onNavigate}>
        <PlusIcon />
        New chat
      </Link>
      <Link className="side-row" to="/home?view=artifacts" onClick={onNavigate}>
        <GridIcon />
        Artifacts
      </Link>
    </>
  );
}

function ConvoList({ onNavigate }: { onNavigate?: () => void }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);

  useEffect(() => {
    listConversations()
      .then(setConversations)
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, []);

  return (
    <>
      {groupByRecency(conversations).map((group) => (
        <div key={group.group}>
          <div className="group-label">{group.group}</div>
          {group.items.map((c) => (
            <Link
              key={c.id}
              className="convo"
              to={`/home?conversation=${c.id}`}
              onClick={onNavigate}
            >
              {c.title ?? "New conversation"}
            </Link>
          ))}
        </div>
      ))}
    </>
  );
}

function SettingsRow({
  name,
  active,
  onNavigate,
}: {
  name: string;
  active?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      className={active ? "settings-row on" : "settings-row"}
      to="/account"
      onClick={onNavigate}
    >
      <span className="settings-avatar">{initials(name)}</span>
      <span className="settings-name">{name}</span>
      <GearIcon />
    </Link>
  );
}

/** Always visible, desktop only. Collapses to width 0 rather than unmounting,
 *  so the transition can animate. */
export function Sidebar({
  name,
  active,
  collapsed,
}: {
  name: string;
  active?: "account";
  collapsed: boolean;
}) {
  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
      <div className="sidebar-top">
        <div className="brand-row">
          <BrandMark />
          <BrandWord />
        </div>
        <NavRows />
      </div>
      <div className="sidebar-scroll">
        <ConvoList />
      </div>
      <div className="sidebar-bottom">
        <SettingsRow name={name} active={active === "account"} />
      </div>
    </aside>
  );
}

/** Off-canvas, mobile only: slides in over an overlay rather than pushing
 *  content, same mechanics as design/v2/dashboard/mobile.html's drawer —
 *  including closing itself the moment any row is followed, per that same
 *  design's script. */
export function Drawer({
  name,
  active,
  open,
  onClose,
}: {
  name: string;
  active?: "account";
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      <div
        className={open ? "overlay open" : "overlay"}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={open ? "drawer open" : "drawer"} aria-hidden={!open}>
        <div className="drawer-top">
          <div className="brand-row">
            <div className="brand">
              <BrandMark />
              <BrandWord />
            </div>
            <button className="icon-btn" aria-label="Close menu" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <NavRows onNavigate={onClose} />
        </div>
        <div className="drawer-scroll">
          <ConvoList onNavigate={onClose} />
        </div>
        <div className="drawer-bottom">
          <SettingsRow name={name} active={active === "account"} onNavigate={onClose} />
        </div>
      </aside>
    </>
  );
}

/** The header every shelled screen shares: a menu toggle on the left (collapse
 *  the sidebar on desktop, open the drawer on mobile), the page title, and a
 *  "Chat" shortcut back to /home on the right. The chat screen itself draws
 *  its own header instead of this one — see routes/home.tsx. */
export function Header({
  title,
  pressed,
  onToggle,
  isDesktop,
}: {
  title: string;
  pressed: boolean;
  onToggle: () => void;
  isDesktop: boolean;
}) {
  return (
    <div className="header">
      <div className="header-left">
        <button
          className="icon-btn"
          aria-label={isDesktop ? "Toggle sidebar" : "Open menu"}
          aria-pressed={isDesktop ? pressed : undefined}
          onClick={onToggle}
        >
          {isDesktop ? <SidebarToggleIcon /> : <MenuIcon />}
        </button>
        <span className="home-title">{title}</span>
      </div>
      <div className="header-right">
        <Link className="btn-chat" to="/home">
          <ChatIcon />
          Chat
        </Link>
      </div>
    </div>
  );
}

/** Same header, for the chat screen, with the shortcut pointed the other way. */
export function DashboardLinkHeader({
  title,
  pressed,
  onToggle,
  isDesktop,
}: {
  title: string;
  pressed: boolean;
  onToggle: () => void;
  isDesktop: boolean;
}) {
  return (
    <div className="header">
      <div className="header-left">
        <button
          className="icon-btn"
          aria-label={isDesktop ? "Toggle sidebar" : "Open menu"}
          aria-pressed={isDesktop ? pressed : undefined}
          onClick={onToggle}
        >
          {isDesktop ? <SidebarToggleIcon /> : <MenuIcon />}
        </button>
        <span className="home-title">{title}</span>
      </div>
      <div className="header-right">
        <Link className="btn-chat" to="/dashboard">
          <DashboardBtnIcon />
          Dashboard
        </Link>
      </div>
    </div>
  );
}

/** The page-shell used by dashboard, a pet's Feed/About tabs, and account: a
 *  sidebar/drawer plus a scrolling `.page` of the given width. The chat
 *  screen composes `Sidebar`/`Drawer`/`Header` itself instead, since its body
 *  is a fixed thread + composer rather than a scrolling page. */
export function Shell({
  name,
  title,
  active,
  width = "wide",
  children,
}: {
  name: string;
  title: string;
  active?: "account";
  width?: PageWidth;
  children: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className={isDesktop ? "shell-desktop" : "shell-mobile"}>
      {isDesktop ? (
        <Sidebar name={name} active={active} collapsed={collapsed} />
      ) : (
        <Drawer
          name={name}
          active={active}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}
      <div className="main">
        <Header
          title={title}
          isDesktop={isDesktop}
          pressed={isDesktop ? !collapsed : drawerOpen}
          onToggle={() =>
            isDesktop ? setCollapsed((c) => !c) : setDrawerOpen((o) => !o)
          }
        />
        <div className="page-wrap">
          <div className="page" data-width={width}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
