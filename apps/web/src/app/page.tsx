"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function Home() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub?.subscription.unsubscribe();
  }, [supabase]);

  async function signIn() {
    if (!supabase) return;
    setAuthStatus("");
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthStatus(error.message);
    setAuthBusy(false);
  }

  async function signUp() {
    if (!supabase) return;
    setAuthStatus("");
    setAuthBusy(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setAuthStatus(error ? error.message : "Check your email to confirm sign-up.");
    setAuthBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
  }

  if (!supabase) {
    return (
      <div className="card" style={{ margin: 24 }}>
        <h1>Fitness Coach</h1>
        <p className="muted">Missing Supabase environment variables.</p>
        <pre>Configure <code>apps/web/.env.local</code> with <br />NEXT_PUBLIC_SUPABASE_URL<br />NEXT_PUBLIC_SUPABASE_ANON_KEY<br />NEXT_PUBLIC_COACH_FUNCTION_URL</pre>
        <p className="muted">See <code>.env.example</code> in the root.</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="card" style={{ margin: 24, maxWidth: 400 }}>
        <h1>Fitness Coach</h1>
        <p className="muted" style={{ marginBottom: 16 }}>Sign in to get started.</p>

        <div className="field" style={{ marginTop: 8 }}>
          <label>Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={signIn} disabled={authBusy}>{authBusy ? "..." : "Sign in"}</button>
          <button className="btn btnSecondary" onClick={signUp} disabled={authBusy}>Sign up</button>
        </div>

        {authStatus ? <p className="muted" style={{ marginTop: 12 }}>{authStatus}</p> : null}
      </div>
    );
  }

  return (
    <div>
      <div className="card" style={{ margin: 24 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0 }}>Fitness Coach</h1>
            <p className="muted" style={{ margin: 0 }}>Signed in as {session.user?.email ?? "unknown"}</p>
          </div>
          <button className="btn btnSecondary" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div className="row" style={{ margin: "0 24px", gap: 12 }}>
        <Link href="/chat" className="card" style={{ flex: 1, textDecoration: "none", color: "inherit", transition: "border-color 0.15s", cursor: "pointer" }}>
          <h3>AI Coach Chat</h3>
          <p className="muted">Get personalised fitness advice, ask questions about your routine, or discuss your goals with your AI coach.</p>
        </Link>

        <Link href="/checkin" className="card" style={{ flex: 1, textDecoration: "none", color: "inherit", transition: "border-color 0.15s", cursor: "pointer" }}>
          <h3>Daily Check-in</h3>
          <p className="muted">Log your steps, sleep, pain, stress, and soreness so your coach can adjust recommendations.</p>
        </Link>

        <Link href="/profile" className="card" style={{ flex: 1, textDecoration: "none", color: "inherit", transition: "border-color 0.15s", cursor: "pointer" }}>
          <h3>Profile</h3>
          <p className="muted">Update your fitness profile, preferences, constraints, and equipment.</p>
        </Link>
      </div>

      <div style={{ margin: "12px 24px" }}>
        <Link href="/privacy" className="muted" style={{ fontSize: 12 }}>Privacy Policy</Link>
      </div>
    </div>
  );
}
