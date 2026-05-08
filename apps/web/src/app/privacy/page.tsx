"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Memory = {
  id: string;
  kind: string;
  content: string;
  created_at: string;
};

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PrivacyPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      setStatus("");
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        setStatus("Not signed in.");
        return;
      }

      const { data, error } = await supabase
        .from("memories")
        .select("id,kind,content,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) setStatus(error.message);
      else setMemories((data as Memory[]) ?? []);
    }
    load();
  }, [supabase]);

  if (!supabase) {
    return (
      <div className="card">
        <p>
          Missing Supabase env. Configure <code>apps/web/.env.local</code> and restart dev server.
        </p>
        <Link href="/">Home</Link>
      </div>
    );
  }

  async function exportAll() {
    if (!supabase) return;
    setStatus("");
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Not signed in");

      const [
        profile,
        goals,
        plans,
        checkIns,
        mem,
        chatSessions,
        chatMessages,
        evidenceDocs,
        evidenceCitations,
      ] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("goals").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("plans").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("check_ins").select("*").eq("user_id", userId).order("at_date", { ascending: false }),
        supabase.from("memories").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("chat_sessions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("chat_messages").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("evidence_docs").select("*").eq("user_id", userId).order("retrieved_at", { ascending: false }),
        supabase.from("evidence_citations").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      ]);

      const out = {
        exported_at: new Date().toISOString(),
        user_id: userId,
        profile: profile.data,
        goals: goals.data,
        plans: plans.data,
        check_ins: checkIns.data,
        memories: mem.data,
        chat_sessions: chatSessions.data,
        chat_messages: chatMessages.data,
        evidence_docs: evidenceDocs.data,
        evidence_citations: evidenceCitations.data,
        errors: {
          profile: profile.error?.message ?? null,
          goals: goals.error?.message ?? null,
          plans: plans.error?.message ?? null,
          check_ins: checkIns.error?.message ?? null,
          memories: mem.error?.message ?? null,
          chat_sessions: chatSessions.error?.message ?? null,
          chat_messages: chatMessages.error?.message ?? null,
          evidence_docs: evidenceDocs.error?.message ?? null,
          evidence_citations: evidenceCitations.error?.message ?? null,
        },
      };

      downloadJson("fitness-coach-export.json", out);
      setStatus("Export downloaded.");
    } catch (e) {
      setStatus(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMemory(id: string) {
    if (!supabase) return;
    setStatus("");
    setBusy(true);
    try {
      const { error } = await supabase.from("memories").delete().eq("id", id);
      if (error) throw error;
      setMemories((ms) => ms.filter((m) => m.id !== id));
      setStatus("Memory deleted.");
    } catch (e) {
      setStatus(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2>Privacy</h2>
        <Link href="/">Home</Link>
      </div>

      <p className="muted">
        Export your data and delete specific memories. (Demo: shows the latest 50 memory items.)
      </p>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={exportAll} disabled={busy}>
          {busy ? "Working..." : "Download data export"}
        </button>
        {status ? <span className="muted">{status}</span> : null}
      </div>

      <h3 style={{ marginTop: 18 }}>Memories</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {memories.map((m) => (
          <div key={m.id} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="muted">
                {m.kind} • {new Date(m.created_at).toLocaleString()}
              </div>
              <button className="btn btnSecondary" onClick={() => deleteMemory(m.id)} disabled={busy}>
                Delete
              </button>
            </div>
            <pre style={{ marginTop: 10 }}>{m.content}</pre>
          </div>
        ))}
        {!memories.length ? <p className="muted">No memories found.</p> : null}
      </div>
    </div>
  );
}

