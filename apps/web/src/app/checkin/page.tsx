"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export default function CheckInPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [steps, setSteps] = useState("");
  const [sleep, setSleep] = useState("");
  const [pain, setPain] = useState("");
  const [soreness, setSoreness] = useState("");
  const [stress, setStress] = useState("");
  const [notes, setNotes] = useState("");

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, [supabase]);

  function validate(): boolean {
    const errs: Record<string, string> = {};

    if (steps && (isNaN(Number(steps)) || Number(steps) < 0 || Number(steps) > 200000)) {
      errs.steps = "Enter a valid step count (0-200,000).";
    }
    if (sleep && (isNaN(Number(sleep)) || Number(sleep) < 0 || Number(sleep) > 24)) {
      errs.sleep = "Enter valid hours (0-24).";
    }
    if (pain && (isNaN(Number(pain)) || Number(pain) < 0 || Number(pain) > 10)) {
      errs.pain = "Rate 0-10.";
    }
    if (soreness && (isNaN(Number(soreness)) || Number(soreness) < 0 || Number(soreness) > 10)) {
      errs.soreness = "Rate 0-10.";
    }
    if (stress && (isNaN(Number(stress)) || Number(stress) < 0 || Number(stress) > 10)) {
      errs.stress = "Rate 0-10.";
    }

    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit() {
    setStatus("");
    setSaved(false);
    if (!validate()) return;
    if (!supabase || !userId) return;
    setBusy(true);

    const toNum = (v: string) => (v === "" || v === null || v === undefined ? null : Number(v));
    const today = new Date().toISOString().slice(0, 10);

    const { error } = await supabase.from("check_ins").upsert(
      {
        user_id: userId,
        at_date: today,
        steps: toNum(steps),
        sleep_hours: toNum(sleep),
        pain_score: toNum(pain),
        soreness_score: toNum(soreness),
        stress_score: toNum(stress),
        notes: notes || null,
      },
      { onConflict: "user_id,at_date" }
    );

    if (error) setStatus(error.message);
    else {
      setSaved(true);
      setStatus("Saved!");
      setTimeout(() => setSaved(false), 2000);
    }
    setBusy(false);
  }

  if (!supabase) {
    return (
      <div className="card">
        <p>Missing Supabase env. Configure <code>apps/web/.env.local</code> and restart dev server.</p>
        <Link href="/">Home</Link>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="card">
        <p>You need to sign in first.</p>
        <Link href="/">Home</Link>
      </div>
    );
  }

  const field = (label: string, value: string, set: (v: string) => void, opts: { hint?: string; type?: string; placeholder?: string; errorKey?: string }) => (
    <div className="field">
      <label>
        {label}
        {opts.hint ? <span className="hint"> ({opts.hint})</span> : null}
      </label>
      <input
        className="input"
        type={opts.type ?? "text"}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={opts.placeholder ?? ""}
      />
      {opts.errorKey && validationErrors[opts.errorKey] ? (
        <span className="hint" style={{ color: "#f87171" }}>{validationErrors[opts.errorKey]}</span>
      ) : null}
    </div>
  );

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2>Daily Check-in</h2>
        <Link href="/">Home</Link>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        {field("Steps", steps, setSteps, { hint: "today&apos;s count", placeholder: "e.g. 8000", errorKey: "steps" })}
        {field("Sleep hours", sleep, setSleep, { hint: "last night", placeholder: "e.g. 7.5", errorKey: "sleep" })}
        {field("Pain (0-10)", pain, setPain, { placeholder: "0-10", errorKey: "pain" })}
        {field("Soreness (0-10)", soreness, setSoreness, { placeholder: "0-10", errorKey: "soreness" })}
        {field("Stress (0-10)", stress, setStress, { placeholder: "0-10", errorKey: "stress" })}
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>Notes</label>
        <textarea
          className="input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="How did your workout feel? Anything unusual?"
        />
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn" onClick={submit} disabled={busy}>
          {busy ? "Saving..." : saved ? "Saved!" : "Save check-in"}
        </button>
        {status && !saved ? <span className="muted" style={{ alignSelf: "center" }}>{status}</span> : null}
      </div>
    </div>
  );
}
