"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Profile = {
  user_id: string;
  display_name: string | null;
  primary_group: string | null;
  experience_level: string | null;
  height_cm: number | null;
  birth_year: number | null;
  preferences: Record<string, unknown>;
  constraints: Record<string, unknown>;
  equipment: Record<string, unknown>;
};

const defaultPreferences = {
  tone: "friendly",
  workout_time: "",
  comm_frequency: "",
};

const defaultConstraints = {
  max_session_minutes: 60,
  available_days: "",
  budget: "",
};

export default function ProfilePage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      setStatus("");
      if (!supabase) return;
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) return;

      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (error) setStatus(error.message);
      else setProfile((data as Profile) ?? null);
    }
    load();
  }, [supabase]);

  async function save() {
    if (!profile) return;
    setStatus("");
    setSaved(false);
    setBusy(true);
    if (!supabase) return;

    const prefs = profile.preferences ?? {};
    const cons = profile.constraints ?? {};
    const eq = profile.equipment ?? {};

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: profile.display_name,
        primary_group: profile.primary_group,
        experience_level: profile.experience_level,
        height_cm: profile.height_cm,
        birth_year: profile.birth_year,
        preferences: prefs,
        constraints: cons,
        equipment: eq,
      })
      .eq("user_id", profile.user_id);

    if (error) setStatus(error.message);
    else {
      setStatus("Saved.");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setBusy(false);
  }

  const updatePref = (key: string, value: string) => {
    if (!profile) return;
    setProfile({ ...profile, preferences: { ...profile.preferences, [key]: value } });
  };

  const updateConstraint = (key: string, value: string) => {
    if (!profile) return;
    setProfile({ ...profile, constraints: { ...profile.constraints, [key]: value } });
  };

  const updateEquipment = (equipmentStr: string) => {
    if (!profile) return;
    setProfile({
      ...profile,
      equipment: equipmentStr ? { items: equipmentStr.split(",").map((s) => s.trim()).filter(Boolean) } : {},
    });
  };

  const equipmentStr = (): string => {
    if (!profile) return "";
    const eq = profile.equipment ?? {};
    const items = Array.isArray((eq as any).items) ? (eq as any).items : [];
    return items.length ? items.join(", ") : "";
  };

  if (!supabase) {
    return (
      <div className="card">
        <p>Missing Supabase env. Configure <code>apps/web/.env.local</code> and restart dev server.</p>
        <Link href="/">Home</Link>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="card">
        <p>Loading profile...</p>
        <Link href="/">Home</Link>
        {status ? <p className="muted">{status}</p> : null}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2>Profile</h2>
        <Link href="/">Home</Link>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Display name</label>
          <input className="input" value={profile.display_name ?? ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} />
        </div>
        <div className="field">
          <label>Coach tone</label>
          <select className="input" value={(profile.preferences as any)?.tone ?? "friendly"} onChange={(e) => updatePref("tone", e.target.value)}>
            <option value="friendly">Friendly</option>
            <option value="brief">Brief</option>
            <option value="strict">Strict</option>
          </select>
        </div>
        <div className="field">
          <label>Primary group</label>
          <select className="input" value={profile.primary_group ?? "general"} onChange={(e) => setProfile({ ...profile, primary_group: e.target.value })}>
            <option value="general">General</option>
            <option value="office_worker">Office worker</option>
            <option value="athlete">Athlete</option>
            <option value="older_adult">Older adult</option>
            <option value="patient">Patient</option>
          </select>
        </div>
        <div className="field">
          <label>Experience</label>
          <select className="input" value={profile.experience_level ?? "beginner"} onChange={(e) => setProfile({ ...profile, experience_level: e.target.value })}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div className="field">
          <label>Birth year (optional)</label>
          <input className="input" type="number" min={1900} max={2030} value={profile.birth_year ?? ""} onChange={(e) => setProfile({ ...profile, birth_year: e.target.value ? Number(e.target.value) : null })} />
        </div>
        <div className="field">
          <label>Height (cm, optional)</label>
          <input className="input" type="number" min={100} max={250} value={profile.height_cm ?? ""} onChange={(e) => setProfile({ ...profile, height_cm: e.target.value ? Number(e.target.value) : null })} />
        </div>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Preferences</h3>
      <div className="row">
        <div className="field">
          <label>Preferred workout time</label>
          <select className="input" value={(profile.preferences as any)?.workout_time ?? ""} onChange={(e) => updatePref("workout_time", e.target.value)}>
            <option value="">Any time</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
        </div>
        <div className="field">
          <label>Communication frequency</label>
          <select className="input" value={(profile.preferences as any)?.comm_frequency ?? ""} onChange={(e) => updatePref("comm_frequency", e.target.value)}>
            <option value="">Default</option>
            <option value="daily">Daily tips</option>
            <option value="weekly">Weekly check-in only</option>
          </select>
        </div>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Constraints</h3>
      <div className="row">
        <div className="field">
          <label>Max session duration (min)</label>
          <select className="input" value={String((profile.constraints as any)?.max_session_minutes ?? 60)} onChange={(e) => updateConstraint("max_session_minutes", e.target.value)}>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="45">45 min</option>
            <option value="60">60 min</option>
            <option value="90">90 min</option>
          </select>
        </div>
        <div className="field">
          <label>Available days</label>
          <select className="input" value={(profile.constraints as any)?.available_days ?? ""} onChange={(e) => updateConstraint("available_days", e.target.value)}>
            <option value="">Any day</option>
            <option value="weekdays">Weekdays only</option>
            <option value="weekends">Weekends only</option>
            <option value="3_days">3 days/week</option>
            <option value="4_days">4 days/week</option>
            <option value="5_days">5 days/week</option>
            <option value="6_days">6 days/week</option>
          </select>
        </div>
        <div className="field">
          <label>Budget for equipment</label>
          <select className="input" value={(profile.constraints as any)?.budget ?? ""} onChange={(e) => updateConstraint("budget", e.target.value)}>
            <option value="">No preference</option>
            <option value="none">No equipment (bodyweight)</option>
            <option value="minimal">Minimal (bands, dumbbells)</option>
            <option value="gym">Gym membership</option>
            <option value="home">Home gym setup</option>
          </select>
        </div>
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Equipment</h3>
      <div className="row">
        <div className="field">
          <label>Equipment available <span className="hint">(comma-separated)</span></label>
          <input className="input" value={equipmentStr()} onChange={(e) => updateEquipment(e.target.value)} placeholder="dumbbells, resistance bands, pull-up bar, ..." />
        </div>
      </div>

      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? "Saving..." : saved ? "Saved!" : "Save profile"}
        </button>
        {status && !saved ? <span className="muted" style={{ alignSelf: "center" }}>{status}</span> : null}
      </div>
    </div>
  );
}
