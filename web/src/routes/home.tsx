import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getMe, Unauthorized, type Handler } from "../api";
import {
  DashboardBtnIcon,
  DashboardLinkHeader,
  Drawer,
  MenuIcon,
  PlusIcon,
  Sidebar,
} from "../shell/Shell";
import { useIsDesktop } from "../shell/useIsDesktop";
import "../shell/shell.css";
import "../home/home.css";

type CardData = {
  date: string;
  pet: string;
  kind: string;
  when?: string;
  overdueDays?: string;
  milestone?: boolean;
};
type Block = { kind: "p"; text: string } | { kind: "card"; card: CardData };
type Turn = { id: string; role: "user"; text: string } | { id: string; role: "assistant"; blocks: Block[] };

const REPLIES = [
  "Got it — logged and closed out the open due date.",
  "Noted. Want me to set a reminder date for the next one?",
  "Done. Anything else from today?",
];

/** The same canned conversation the design ships, opened on every visit and
 *  restored by "New chat" — there is no real chat backend yet, see the plan. */
function initialTurns(name: string): Turn[] {
  return [
    {
      id: "greeting",
      role: "assistant",
      blocks: [
        { kind: "p", text: `Welcome back, ${name}. One thing needs attention before anything else:` },
        {
          kind: "card",
          card: {
            date: "14 JUL 2026",
            pet: "Biscuit",
            kind: "Rabies booster",
            when: "Overdue",
            overdueDays: "46 DAYS",
          },
        },
        { kind: "p", text: "2 more are due within the next 30 days. What would you like to log or ask about?" },
      ],
    },
    {
      id: "u1",
      role: "user",
      text: "Biscuit had his deworming today — no issues. Vet says next dose in 3 months.",
    },
    {
      id: "a2",
      role: "assistant",
      blocks: [
        { kind: "p", text: "Logged. Here's the entry:" },
        { kind: "card", card: { date: "23 SEP 2026", pet: "Biscuit", kind: "Deworming", when: "Due 23 Dec 2026" } },
        { kind: "p", text: "Anything else from today?" },
      ],
    },
    {
      id: "u2",
      role: "user",
      text: 'Also — he finally learned "sit" and "stay" this week, three short sessions and he\'s got it.',
    },
    {
      id: "a3",
      role: "assistant",
      blocks: [
        { kind: "p", text: "Nice! Logged that too:" },
        { kind: "card", card: { date: "23 SEP 2026", pet: "Biscuit", kind: "Training", milestone: true } },
        { kind: "p", text: "Great progress." },
      ],
    },
  ];
}

const ARTIFACTS = [
  {
    pet: "Biscuit",
    tint: "a",
    items: [
      { name: "profile_photo.jpg", date: "12 AUG 2026", doc: false },
      { name: "rabies_certificate.pdf", date: "12 AUG 2026", doc: true },
      { name: "vet_note_deworming.pdf", date: "23 SEP 2026", doc: true },
    ],
  },
  {
    pet: "Momo",
    tint: "b",
    items: [
      { name: "profile_photo.jpg", date: "21 AUG 2026", doc: false },
      { name: "grooming_before.jpg", date: "03 SEP 2026", doc: false },
    ],
  },
  { pet: "Pepper", tint: "c", items: [{ name: "vet_visit.jpg", date: "02 AUG 2026", doc: false }] },
];

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5l2.1 5.8 6.1.4-4.8 3.9 1.7 5.9-5.1-3.5-5.1 3.5 1.7-5.9-4.8-3.9 6.1-.4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8.5" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 16.5l5-4.5 4 3 3-2.5 4 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 2.5h8l4 4V21a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M14 2.5V7h4.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 19V5M6 11l6-6 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The editorial identity dropped inline into the conversation — not a real
 *  link, since there is no real pet behind this demo conversation. */
function LedgerCardEl({ card }: { card: CardData }) {
  const over = card.overdueDays !== undefined;
  return (
    <div className={over ? "ledger-card over" : "ledger-card"}>
      <span className="date">{card.date}</span>
      <span className="what">
        <b>{card.pet}</b>
        <span className="slash">/</span>
        <span className="kind">{card.kind}</span>
      </span>
      {card.milestone ? (
        <span className="tag milestone">
          <TrophyIcon />
          Milestone
        </span>
      ) : (
        <span className="when">{card.when}</span>
      )}
      {over && (
        <span className="card-stamp">
          OVERDUE<span className="days">{card.overdueDays}</span>
        </span>
      )}
    </div>
  );
}

function TurnEl({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <div className="turn user">
        <div className="user-bubble">{turn.text}</div>
      </div>
    );
  }
  return (
    <div className="turn assistant">
      <div className="assistant-text">
        {turn.blocks.map((block, i) =>
          block.kind === "p" ? <p key={i}>{block.text}</p> : <LedgerCardEl key={i} card={block.card} />,
        )}
      </div>
    </div>
  );
}

function ArtifactsView() {
  return (
    <div className="artifacts-page">
      <div className="artifacts-in">
        <div className="art-head">
          <h1>Artifacts</h1>
          <p>Everything you've attached in chat — photos and documents, filed under the pet they belong to.</p>
        </div>
        {ARTIFACTS.map((group) => (
          <div key={group.pet}>
            <div className="art-sect">
              <h2>{group.pet}</h2>
              <span className="line" />
              <span className="n">{group.items.length}</span>
            </div>
            <div className="art-grid">
              {group.items.map((item) => (
                <div key={item.name} className={item.doc ? "art-card doc" : "art-card"}>
                  <div className={`thumb ${group.tint}`}>{item.doc ? <DocIcon /> : <PhotoIcon />}</div>
                  <div className="meta">
                    <div className="fname">{item.name}</div>
                    <div className="fsub">{item.date}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [searchParams] = useSearchParams();
  const [handler, setHandler] = useState<Handler | null>(null);
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const replyIndexRef = useRef(0);

  const view: "chat" | "artifacts" = searchParams.get("view") === "artifacts" ? "artifacts" : "chat";
  const isNew = searchParams.get("new") === "1";

  useEffect(() => {
    getMe()
      .then(setHandler)
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, []);

  // Loads the greeting once the handler's name is known, and again whenever
  // "New chat" (?new=1) is followed.
  useEffect(() => {
    if (handler) setTurns(initialTurns(handler.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler, isNew]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, isDesktop ? 180 : 140) + "px";
  }, [draft, isDesktop]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  if (!handler) return null;

  function addAssistantReply(text: string, delay: number) {
    const id = crypto.randomUUID();
    setTimeout(() => {
      setTurns((t) => [...t, { id, role: "assistant", blocks: [{ kind: "p", text }] }]);
    }, delay);
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    setTurns((t) => [...t, { id: crypto.randomUUID(), role: "user", text }]);
    setDraft("");
    addAssistantReply(REPLIES[replyIndexRef.current % REPLIES.length], 500);
    replyIndexRef.current++;
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function logDemo() {
    setTurns((t) => [
      ...t,
      {
        id: crypto.randomUUID(),
        role: "user",
        text: "Pepper is due for her DHPP booster next week — just confirming with the vet tomorrow.",
      },
    ]);
    addAssistantReply("Noted — I'll flag it as due once you confirm the date with the vet.", 700);
  }

  const title = view === "artifacts" ? "Artifacts" : "Paw Pages";

  return (
    <div className={isDesktop ? "shell-desktop" : "shell-mobile"}>
      {isDesktop ? (
        <Sidebar name={handler.name} collapsed={collapsed} />
      ) : (
        <Drawer name={handler.name} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      )}
      <div className="main">
        {isDesktop ? (
          <DashboardLinkHeader
            title={title}
            isDesktop
            pressed={!collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
        ) : (
          <div className="header">
            <div className="header-left">
              <button className="icon-btn" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
                <MenuIcon />
              </button>
              <span className="home-title">{title}</span>
            </div>
            <div className="header-right">
              <Link className="icon-btn" to="/dashboard" aria-label="Open dashboard">
                <DashboardBtnIcon />
              </Link>
              <button
                className="icon-btn"
                aria-label="New chat"
                onClick={() => setTurns(initialTurns(handler.name))}
              >
                <PlusIcon />
              </button>
            </div>
          </div>
        )}

        {view === "artifacts" ? (
          <ArtifactsView />
        ) : (
          <div className="chat-view">
            <div className="thread-wrap" ref={threadRef}>
              <div className="thread">
                {turns.map((turn) => (
                  <TurnEl key={turn.id} turn={turn} />
                ))}
              </div>
            </div>
            <div className="composer-area">
              <div className="composer-inner">
                <div className="composer">
                  <button className="composer-plus" aria-label="Attach a photo" onClick={logDemo}>
                    <AttachIcon />
                  </button>
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    placeholder="Ask Paw Pages, or log something new"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKeyDown}
                  />
                  <div className="composer-right">
                    <button className="mic-btn" aria-label="Dictate">
                      <MicIcon />
                    </button>
                    <button
                      className={draft.trim() ? "send-btn ready" : "send-btn"}
                      aria-label="Send message"
                      onClick={send}
                    >
                      <SendIcon />
                    </button>
                  </div>
                </div>
                <div className="disclaimer">
                  Paw Pages can misread details — check important dates before confirming.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
