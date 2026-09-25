import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  getConversation,
  getMe,
  sendChatMessage,
  Unauthorized,
  type ConversationTurn,
  type Handler,
} from "../api";
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

/** Chrome, not a turn -- purely local, never sent as part of the
 *  conversation. The real thread starts from the first message the handler
 *  actually sends. Restored by "New chat" alongside a null conversation id. */
function initialTurns(name: string): Turn[] {
  return [
    {
      id: "greeting",
      role: "assistant",
      blocks: [{ kind: "p", text: `Welcome back, ${name}. What would you like to log or ask about?` }],
    },
  ];
}

function turnFromHistory(turn: ConversationTurn, i: number): Turn {
  return turn.role === "user"
    ? { id: `h${i}`, role: "user", text: turn.content }
    : { id: `h${i}`, role: "assistant", blocks: [{ kind: "p", text: turn.content }] };
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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const view: "chat" | "artifacts" = searchParams.get("view") === "artifacts" ? "artifacts" : "chat";
  const isNew = searchParams.get("new") === "1";
  const conversationParam = searchParams.get("conversation");

  useEffect(() => {
    getMe()
      .then(setHandler)
      .catch((error) => {
        if (!(error instanceof Unauthorized)) throw error;
      });
  }, []);

  // Three ways to land here: "New chat" (?new=1, greeting + no conversation),
  // a sidebar entry (?conversation=<id>, hydrates its history), or neither
  // (first load -- same as new). Runs again whenever the handler's name
  // becomes known or either param changes.
  useEffect(() => {
    if (!handler) return;
    if (!conversationParam) {
      setTurns(initialTurns(handler.name));
      setConversationId(null);
      return;
    }
    getConversation(conversationParam)
      .then((conversation) => {
        setTurns(conversation.history.map(turnFromHistory));
        setConversationId(conversation.id);
      })
      .catch((error) => {
        if (error instanceof Unauthorized) throw error;
        // Stale or foreign id -- fall back to a fresh chat rather than a dead screen.
        setTurns(initialTurns(handler.name));
        setConversationId(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handler, isNew, conversationParam]);

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

  function appendAssistantDelta(id: string, delta: string) {
    setTurns((t) =>
      t.map((turn) => {
        if (turn.id !== id || turn.role !== "assistant") return turn;
        const block = turn.blocks[0];
        const prevText = block && block.kind === "p" ? block.text : "";
        return { ...turn, blocks: [{ kind: "p", text: prevText + delta }] };
      }),
    );
  }

  function setAssistantText(id: string, text: string) {
    setTurns((t) =>
      t.map((turn) => (turn.id === id && turn.role === "assistant" ? { ...turn, blocks: [{ kind: "p", text }] } : turn)),
    );
  }

  async function send() {
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft("");
    setTurns((t) => [...t, { id: crypto.randomUUID(), role: "user", text }]);

    const assistantId = crypto.randomUUID();
    setTurns((t) => [...t, { id: assistantId, role: "assistant", blocks: [{ kind: "p", text: "" }] }]);

    setIsSending(true);
    try {
      await sendChatMessage(conversationId, text, (event) => {
        if (event.type === "conversation") setConversationId(event.id);
        else if (event.type === "text.delta") appendAssistantDelta(assistantId, event.text);
      });
    } catch (error) {
      if (error instanceof Unauthorized) throw error;
      setAssistantText(assistantId, "Something went wrong. Try again.");
    } finally {
      setIsSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
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
                onClick={() => {
                  setTurns(initialTurns(handler.name));
                  setConversationId(null);
                }}
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
                  {/* Wiring this up is a separate ticket -- attaching a photo needs the
                      pawpages_uploads flow, not the plain chat endpoint this screen now uses. */}
                  <button className="composer-plus" aria-label="Attach a photo">
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
                      disabled={isSending}
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
