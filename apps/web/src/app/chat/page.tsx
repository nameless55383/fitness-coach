"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { sendCoachMessage, type CoachReply } from "@/lib/coachApi";

type Msg = { role: "user" | "assistant"; content: string };
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

export default function ChatPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [ready, setReady] = useState(false);
  const [accessToken, setAccessToken] = useState<string>("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [message, setMessage] = useState("");
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [latestCheckIn, setLatestCheckIn] = useState<CheckIn | null>(null);
  const [editingCheckIn, setEditingCheckIn] = useState(false);
  const [checkInDraft, setCheckInDraft] = useState<Record<string, string | null | undefined>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setReady(Boolean(data.session?.access_token));
      if (data.session?.access_token) setAccessToken(data.session.access_token);
    });
  }, [supabase]);

  useEffect(() => {
    async function loadLatest() {
      if (!supabase) return;
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;

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
    loadLatest();
  }, [supabase]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
    <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "70dvh" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Coach Chat</h2>
        <div className="row" style={{ alignItems: "center" }}>
          <button
            className="btn btnSecondary"
            disabled={busy}
            onClick={() => {
              setSessionId(undefined);
              setMessages([]);
              setError("");
            }}
          >
            New chat
          </button>
          <Link href="/">Home</Link>
        </div>
      </div>

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
                      const userId = userData.user?.id;
                      if (!userId) throw new Error("Not signed in");

                      const toNum = (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v));
                      const payload = {
                        user_id: userId,
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
    </div>
  );
}
