"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { sendCoachMessage, type CoachReply } from "@/lib/coachApi";

type Msg = { role: "user" | "assistant"; content: string };
type Session = { id: string; title: string; created_at: string };
type CheckIn = {
  at_date: string;
  weight_kg: number | null;
  steps: number | null;
  sleep_hours: number | null;
  pain_score: number | null;
  soreness_score: number | null;
  stress_score: number | null;
  notes: string | null;
  updated_at?: string;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [ready, setReady] = useState(false);
  const [accessToken, setAccessToken] = useState<string>("");
  const [userId, setUserId] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [latestCheckIn, setLatestCheckIn] = useState<CheckIn | null>(null);
  const [editingCheckIn, setEditingCheckIn] = useState(false);
  const [checkInDraft, setCheckInDraft] = useState<Record<string, string | null | undefined>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token;
      const uid = data.session?.user?.id;
      setReady(Boolean(token));
      if (token) setAccessToken(token);
      if (uid) setUserId(uid);
    });
  }, [supabase]);

  const loadSessions = useCallback(async () => {
    if (!supabase || !userId) return;
    setLoadingSessions(true);
    const { data } = await supabase
      .from("chat_sessions")
      .select("id,title,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    setSessions((data ?? []) as Session[]);
    setLoadingSessions(false);
  }, [supabase, userId]);

  const loadMessages = useCallback(async (sid: string) => {
    if (!supabase) return;
    setLoadingMessages(true);
    const { data } = await supabase
      .from("chat_messages")
      .select("role,content")
      .eq("session_id", sid)
      .order("created_at", { ascending: true });
    setMessages((data ?? []) as Msg[]);
    setLoadingMessages(false);
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    loadSessions();
  }, [userId, loadSessions]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    async function loadLatest() {
      if (!supabase || !userId) return;
      const { data } = await supabase
        .from("check_ins")
        .select("at_date,weight_kg,steps,sleep_hours,pain_score,soreness_score,stress_score,notes,updated_at")
        .eq("user_id", userId)
        .order("at_date", { ascending: false })
        .limit(1);
      const ci = (data?.[0] as CheckIn) ?? null;
      setLatestCheckIn(ci);
      setEditingCheckIn(false);
      setCheckInDraft((ci as unknown as Record<string, string | null | undefined>) ?? {});
    }
    if (userId) loadLatest();
  }, [supabase, userId]);

  function switchSession(sid: string) {
    setSessionId(sid);
    setError("");
    loadMessages(sid);
    setSidebarOpen(false);
  }

  function newChat() {
    setSessionId(undefined);
    setMessages([]);
    setError("");
  }

  async function deleteSession(e: React.MouseEvent, sid: string) {
    e.stopPropagation();
    if (!supabase) return;
    if (!confirm("Delete this chat session?")) return;
    await supabase.from("chat_sessions").delete().eq("id", sid);
    setSessions((prev) => prev.filter((s) => s.id !== sid));
    if (sessionId === sid) newChat();
  }

  if (!supabase) {
    return (
      <div className="card">
        <p>Missing Supabase env. Configure <code>apps/web/.env.local</code> and restart dev server.</p>
        <Link href="/">Home</Link>
      </div>
    );
  }

  async function send() {
    setError("");
    const text = message.trim();
    if (!text) return;
    setMessage("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);

    try {
      const res: CoachReply = await sendCoachMessage({
        message: text,
        sessionId,
        includeEvidence,
        accessToken,
      });
      setSessionId(res.session_id);
      const replyWithCitations = res.citations?.length
        ? `${res.reply}\n\nCitations:\n${res.citations
            .map((c, i) => `[${i + 1}] ${c.title} - ${c.url}`)
            .join("\n")}`
        : res.reply;
      setMessages((m) => [...m, { role: "assistant", content: replyWithCitations }]);
      if (userId) loadSessions();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (!ready) {
    return (
      <div className="card">
        <p>Not signed in.</p>
        <Link href="/">Go back</Link>
      </div>
    );
  }

  return (
    <>
      {/* Mobile sidebar overlay */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? "open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <div className="chat-layout">
        {/* Sidebar */}
        <aside className={`chat-sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="chat-sidebar-header">
            <button className="btn" style={{ width: "100%" }} onClick={newChat}>
              + New chat
            </button>
          </div>
          <div className="chat-sidebar-list">
            {loadingSessions ? (
              <p className="muted" style={{ padding: "6px 10px" }}>Loading...</p>
            ) : sessions.length === 0 ? (
              <p className="muted" style={{ padding: "6px 10px" }}>No chats yet</p>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`chat-sidebar-item ${s.id === sessionId ? "active" : ""}`}
                  onClick={() => switchSession(s.id)}
                >
                  <span className="session-title">{s.title || "Chat"}</span>
                  <span className="session-date">{formatDate(s.created_at)}</span>
                  <button className="delete-btn" onClick={(e) => deleteSession(e, s.id)} title="Delete">
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Main chat area */}
        <div className="chat-main">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <button className="sidebar-toggle" onClick={() => setSidebarOpen((v) => !v)}>
              ☰ Sessions
            </button>
            <Link href="/" style={{ fontSize: 14 }}>Home</Link>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {sessionId ? (sessions.find((s) => s.id === sessionId)?.title || "Chat") : "New chat"}
            </h2>
          </div>

          {loadingMessages ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="muted">Loading messages...</span>
            </div>
          ) : (
            <>
              <div style={{ marginTop: 10 }}>
                <div className="muted">Latest check-in (used for adjustments)</div>
                {latestCheckIn ? (
                  <>
                    <div className="row" style={{ marginTop: 8, alignItems: "center" }}>
                      <span className="muted">
                        Date: {latestCheckIn.at_date}
                        {latestCheckIn.updated_at
                          ? ` - Updated: ${new Date(latestCheckIn.updated_at).toLocaleString()}`
                          : ""}
                      </span>
                      <button className="btn btnSecondary" onClick={() => setEditingCheckIn((v) => !v)} disabled={busy}>
                        {editingCheckIn ? "Cancel" : "Edit"}
                      </button>
                      {editingCheckIn ? (
                        <button
                          className="btn"
                          onClick={async () => {
                            setError("");
                            setBusy(true);
                            try {
                              const { data: userData } = await supabase.auth.getUser();
                              const uid = userData.user?.id;
                              if (!uid || !userId) throw new Error("Not signed in");

                              const toNum = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
                              const payload = {
                                user_id: uid,
                                at_date: latestCheckIn.at_date,
                                steps: toNum(checkInDraft.steps),
                                sleep_hours: toNum(checkInDraft.sleep_hours),
                                pain_score: toNum(checkInDraft.pain_score),
                                soreness_score: toNum(checkInDraft.soreness_score),
                                stress_score: toNum(checkInDraft.stress_score),
                                notes: (checkInDraft.notes ?? null) as string | null,
                              };

                              const { data, error: upsertError } = await supabase
                                .from("check_ins")
                                .upsert(payload, { onConflict: "user_id,at_date" })
                                .select("at_date,weight_kg,steps,sleep_hours,pain_score,soreness_score,stress_score,notes,updated_at")
                                .single();
                              if (upsertError) throw upsertError;
                              setLatestCheckIn(data as unknown as CheckIn);
                              setCheckInDraft((data as unknown as Record<string, string | null | undefined>) ?? {});
                              setEditingCheckIn(false);
                            } catch (e) {
                              setError(String((e as Error).message ?? e));
                            } finally {
                              setBusy(false);
                            }
                          }}
                          disabled={busy}
                        >
                          Save
                        </button>
                      ) : null}
                    </div>

                    {editingCheckIn ? (
                      <div className="row" style={{ marginTop: 8 }}>
                        <div className="field">
                          <label>Sleep (h)</label>
                          <input className="input" value={checkInDraft.sleep_hours ?? ""} onChange={(e) => setCheckInDraft({ ...checkInDraft, sleep_hours: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Steps</label>
                          <input className="input" value={checkInDraft.steps ?? ""} onChange={(e) => setCheckInDraft({ ...checkInDraft, steps: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Pain (0-10)</label>
                          <input className="input" value={checkInDraft.pain_score ?? ""} onChange={(e) => setCheckInDraft({ ...checkInDraft, pain_score: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Soreness (0-10)</label>
                          <input className="input" value={checkInDraft.soreness_score ?? ""} onChange={(e) => setCheckInDraft({ ...checkInDraft, soreness_score: e.target.value })} />
                        </div>
                        <div className="field">
                          <label>Stress (0-10)</label>
                          <input className="input" value={checkInDraft.stress_score ?? ""} onChange={(e) => setCheckInDraft({ ...checkInDraft, stress_score: e.target.value })} />
                        </div>
                        <div className="field" style={{ flex: 1, minWidth: 320 }}>
                          <label>Notes</label>
                          <input className="input" value={checkInDraft.notes ?? ""} onChange={(e) => setCheckInDraft({ ...checkInDraft, notes: e.target.value })} />
                        </div>
                      </div>
                    ) : (
                      <pre style={{ marginTop: 8 }}>
                        Sleep: {latestCheckIn.sleep_hours ?? "n/a"} h
                        {"\n"}Steps: {latestCheckIn.steps ?? "n/a"}
                        {"\n"}Pain: {latestCheckIn.pain_score ?? "n/a"}/10
                        {"\n"}Soreness: {latestCheckIn.soreness_score ?? "n/a"}/10
                        {"\n"}Stress: {latestCheckIn.stress_score ?? "n/a"}/10
                        {latestCheckIn.notes ? `\nNotes: ${latestCheckIn.notes}` : ""}
                      </pre>
                    )}
                  </>
                ) : (
                  <p className="muted" style={{ marginTop: 6 }}>
                    None yet. Add one in <Link href="/checkin">Check-in</Link>.
                  </p>
                )}
              </div>

              <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                <input type="checkbox" checked={includeEvidence} onChange={(e) => setIncludeEvidence(e.target.checked)} />
                Include evidence (PubMed)
              </label>

              <div className="chat-messages" style={{ marginTop: 12, flex: 1 }}>
                {messages.map((m, idx) => (
                  <div key={idx} className={`chat-bubble ${m.role}`}>
                    {m.content}
                  </div>
                ))}
                {busy && (
                  <div className="chat-bubble assistant typing-indicator">
                    <span /><span /><span />
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="row" style={{ marginTop: 12 }}>
                <div className="field" style={{ flex: 1, minWidth: 320 }}>
                  <label>Message <span className="hint">(Enter to send, Shift+Enter for new line)</span></label>
                  <textarea
                    ref={textareaRef}
                    className="input"
                    rows={3}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={send} disabled={busy || !message.trim()}>
                  {busy ? "Sending..." : "Send"}
                </button>
                {error ? <span className="muted" style={{ alignSelf: "center" }}>{error}</span> : null}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
