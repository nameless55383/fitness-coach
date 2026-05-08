import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createUserSupabaseClient } from "../_shared/supabase.ts";
import { embedText, generateCoachReply, type ChatMessage } from "../_shared/llm.ts";
import { searchPubMed, type PubmedCitation } from "../_shared/pubmed.ts";

type CoachRequest = {
  message: string;
  session_id?: string;
  include_evidence?: boolean;
};

const COACH_FUNCTION_VERSION = "2026-05-08d";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function shouldFetchEvidence(message: string, includeEvidence?: boolean) {
  if (includeEvidence === true) return true;
  const m = message.toLowerCase();
  return (
    m.includes("study") ||
    m.includes("studies") ||
    m.includes("research") ||
    m.includes("evidence") ||
    m.includes("safe") ||
    m.includes("safety") ||
    m.includes("supplement") ||
    m.includes("creatine") ||
    m.includes("protein") ||
    m.includes("injury") ||
    m.includes("pain")
  );
}

function buildSystemPrompt() {
  return `You are an AI fitness coach chatbot.

Goals:
- Be helpful, conversational, and user-led. Respond directly to what the user asked first.
- Personalize using the provided user profile, goals, check-ins, and remembered notes.
- Be interactive: ask 1–3 short clarifying questions when needed, and offer 2–3 options the user can pick from.
- Keep it practical: give the smallest useful next step, then expand if the user asks.
- Match the user's preferred tone if available in profile.preferences.tone: friendly | brief | strict.
- Do not re-ask questions that are already answered in the user profile or Chat session state. If the answer exists, confirm briefly and move forward.

Safety rules (must follow):
- Be conservative for injuries, older adults, and medical-adjacent questions.
- Do not diagnose. If symptoms sound urgent (chest pain, fainting, severe shortness of breath, new neurological symptoms), advise urgent medical care.
- If you’re unsure about safety, say so and recommend a clinician/physio.

Evidence use:
- If citations are provided, use them to support claims and label uncertainty (e.g. “evidence suggests…”).
- Don’t invent studies or citations.`;
}

function ensureRecord(v: unknown): Record<string, any> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, any>;
}

function firstNonEmptyLine(msg: string) {
  return (msg.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
}

function parseDaysPerWeek(msg: string, allowBareNumber: boolean): number | string | null {
  const m = msg.toLowerCase();
  const range = m.match(/\b([1-7])\s*(?:-|to)\s*([1-7])\s*(?:days?)?\s*(?:\/|\s*per\s*)?week\b/i);
  if (range) return `${range[1]}-${range[2]}`;
  const xWeek =
    m.match(/\b([1-7])\s*(?:x|times?)\s*(?:\/|\s*per\s*)?week\b/i) ??
    m.match(/\b([1-7])\s*days?\s*(?:\/|\s*per\s*)?week\b/i);
  if (xWeek) return Number(xWeek[1]);
  if (allowBareNumber) {
    const bare = m.match(/^\s*([1-7])\s*$/);
    if (bare) return Number(bare[1]);
  }
  return null;
}

function parseMinutesFromText(msg: string, allowBareNumber: boolean): number | null {
  const m = msg.match(/(\d{1,3})\s*(min|mins|minute|minutes)\b/i);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (allowBareNumber) {
    const bare = msg.match(/^\s*(\d{1,3})\s*$/);
    if (bare) {
      const n = Number(bare[1]);
      return Number.isFinite(n) && n >= 5 && n <= 180 ? n : null;
    }
  }
  return null;
}

function parseTimeOfDay(msg: string, defaultAmPm?: "am" | "pm"): string | null {
  const ampm = msg.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    const hh = ampm[1];
    const mm = ampm[2] ? `:${ampm[2]}` : "";
    const ap = ampm[3].toLowerCase();
    return `${hh}${mm}${ap}`;
  }

  const twentyFour = msg.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))\b/);
  if (twentyFour) {
    const hh = String(twentyFour[1]).padStart(2, "0");
    const mm = String(twentyFour[2] ?? "00").padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const m = msg.toLowerCase();
  const hasMorning = m.includes("morning");
  const hasNoon = m.includes("noon") || m.includes("midday");
  const hasAfternoon = m.includes("afternoon");
  const hasEvening = m.includes("evening");
  const hasNight = m.includes("night");
  if (hasMorning || hasNoon || hasAfternoon || hasEvening || hasNight) {
    const early = m.includes("early");
    const late = m.includes("late");
    if (hasNoon) return "12:00";
    if (hasMorning) return early ? "7am" : late ? "11am" : "9am";
    if (hasAfternoon) return early ? "1pm" : late ? "5pm" : "3pm";
    if (hasEvening) return early ? "6pm" : late ? "10pm" : "8pm";
    if (hasNight) return early ? "9pm" : late ? "12:00" : "10pm";
  }

  const nums = [...msg.matchAll(/\b(\d{1,2})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 23);
  if (nums.length) {
    const h = nums[nums.length - 1];
    if (h >= 13) return `${String(h).padStart(2, "0")}:00`;
    if (h === 0) return "00:00";
    const ap = defaultAmPm;
    if (!ap) return null;
    return `${h}${ap}`;
  }

  return null;
}

function updateSessionStateFromUserMessage(args: {
  message: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  sessionState: Record<string, unknown>;
}) {
  const msg = (args.message ?? "").trim();
  if (!msg) return;

  const state = args.sessionState as Record<string, any>;
  const intake = ensureRecord(state.intake);
  state.intake = intake;

  const lastAssistant =
    [...(args.recentMessages ?? [])].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const lastAssistantLower = lastAssistant.toLowerCase();

  const askedDays = lastAssistantLower.includes("days/week") || lastAssistantLower.includes("days per week");
  const askedMinutes = lastAssistantLower.includes("how long per session") || lastAssistantLower.includes("minutes");
  const askedInjuries = lastAssistantLower.includes("injur") || lastAssistantLower.includes("avoid");
  const askedEquipment = lastAssistantLower.includes("equipment");
  const askedNutritionGoal = lastAssistantLower.includes("what’s your goal") || lastAssistantLower.includes("what is your goal");
  const askedRestrictions = lastAssistantLower.includes("preferences/restrictions") || lastAssistantLower.includes("allerg");
  const askedMeals = lastAssistantLower.includes("meals") || lastAssistantLower.includes("snacks");
  const askedOutcome = lastAssistantLower.includes("#1 outcome") || lastAssistantLower.includes("outcome you want");

  if (intake.days_per_week == null) {
    const parsed = parseDaysPerWeek(msg, askedDays);
    if (parsed != null) intake.days_per_week = parsed;
  }

  if (intake.session_minutes == null) {
    const parsed = parseMinutesFromText(msg, askedMinutes);
    if (parsed != null) intake.session_minutes = parsed;
  }

  if (askedDays && intake.days_per_week == null) {
    intake.days_per_week = firstNonEmptyLine(msg).slice(0, 120);
  }
  if (askedMinutes && intake.session_minutes == null) {
    intake.session_minutes = firstNonEmptyLine(msg).slice(0, 120);
  }

  if (intake.injuries == null && (askedInjuries || /\b(pain|injur|avoid|knee|back|shoulder|hip|ankle|wrist|neck)\b/i.test(msg))) {
    const m = msg.toLowerCase();
    if (/\b(none|no injuries|no injury|no pain)\b/i.test(m)) {
      intake.injuries = "none";
    } else {
      intake.injuries = firstNonEmptyLine(msg).slice(0, 240);
    }
  }

  if (intake.equipment == null && (askedEquipment || /\b(gym|dumbbell|barbell|kettlebell|band|machine|treadmill|bike|home|bodyweight|no equipment)\b/i.test(msg))) {
    const m = msg.toLowerCase();
    if (/\b(no equipment|none|bodyweight)\b/i.test(m)) {
      intake.equipment = "bodyweight";
    } else if (m.includes("gym")) {
      intake.equipment = "gym";
    } else {
      intake.equipment = firstNonEmptyLine(msg).slice(0, 240);
    }
  }

  if (intake.nutrition_goal == null && (askedNutritionGoal || /\b(fat loss|lose weight|weight loss|cut|muscle gain|bulk|performance|general health|maintenance)\b/i.test(msg))) {
    intake.nutrition_goal = firstNonEmptyLine(msg).slice(0, 240);
  }

  if (intake.dietary_restrictions == null && (askedRestrictions || /\b(halal|vegetarian|vegan|allerg|gluten|dairy|lactose|kosher)\b/i.test(msg))) {
    const m = msg.toLowerCase();
    if (/\b(none|no restrictions|no preference|no preferences)\b/i.test(m)) {
      intake.dietary_restrictions = "none";
    } else {
      intake.dietary_restrictions = firstNonEmptyLine(msg).slice(0, 240);
    }
  }

  if (intake.meals_per_day == null && (askedMeals || /\b(meal|meals|snack|snacks)\b/i.test(msg))) {
    const m = msg.match(/\b([1-6])\s*(?:meals?|meals\/day|times)\b/i);
    if (m) intake.meals_per_day = Number(m[1]);
  }
  if (askedMeals && intake.meals_per_day == null) {
    intake.meals_per_day = firstNonEmptyLine(msg).slice(0, 120);
  }

  if (intake.outcome_2_4_weeks == null && (askedOutcome || msg.toLowerCase().includes("goal"))) {
    if (msg.length >= 5) intake.outcome_2_4_weeks = firstNonEmptyLine(msg).slice(0, 240);
  }
}

function llmMode() {
  return (Deno.env.get("COACH_LLM_MODE") ?? "openai").toLowerCase();
}

function hasLlmKey() {
  const key =
    Deno.env.get("LLM_API_KEY") ?? Deno.env.get("DEEPSEEK_API_KEY") ?? Deno.env.get("OPENAI_API_KEY");
  return Boolean(key && key.trim().length > 0);
}

function hasEmbeddingKey() {
  const key =
    Deno.env.get("EMBEDDING_API_KEY") ??
    Deno.env.get("OPENAI_API_KEY") ??
    Deno.env.get("LLM_API_KEY") ??
    Deno.env.get("DEEPSEEK_API_KEY");
  return Boolean(key && key.trim().length > 0);
}

function buildEvidenceBlock(citations: PubmedCitation[]) {
  if (!citations.length) return "";
  const lines = citations.map((c, i) => {
    const meta = [c.source, c.pubdate].filter(Boolean).join(", ");
    return `[${i + 1}] ${c.title}${meta ? ` (${meta})` : ""} - ${c.url}`;
  });
  return `\nEvidence (reliable sources):\n${lines.join("\n")}\n`;
}

function pubdateToDate(pubdate?: string): string | null {
  if (!pubdate) return null;
  const match = pubdate.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  return `${match[0]}-01-01`;
}

function isoDateOnly(ts: string) {
  // ts can be date or timestamptz; normalize to YYYY-MM-DD when possible.
  if (!ts) return null;
  const m = ts.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function formatWeeklySummary(checkIns: any[]) {
  if (!checkIns.length) return null;
  const latest = checkIns[0];
  const latestDate = typeof latest?.at_date === "string" ? latest.at_date : null;
  const totalSteps = checkIns.reduce((sum, c) => sum + (typeof c.steps === "number" ? c.steps : 0), 0);
  const stepsDays = checkIns.filter((c) => typeof c.steps === "number").length || 0;
  const avgSteps = stepsDays ? Math.round(totalSteps / stepsDays) : null;

  const avg = (key: string) => {
    const vals = checkIns.map((c) => c[key]).filter((v) => typeof v === "number") as number[];
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };

  const avgSleep = avg("sleep_hours");
  const avgPain = avg("pain_score");
  const avgSoreness = avg("soreness_score");
  const avgStress = avg("stress_score");

  const notes = checkIns
    .map((c) => (typeof c.notes === "string" ? c.notes.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);

  const lines: string[] = [];
  lines.push(`Weekly check-in summary${latestDate ? ` (ending ${latestDate})` : ""}:`);
  if (avgSteps !== null) lines.push(`- Avg steps/day: ${avgSteps}`);
  if (avgSleep !== null) lines.push(`- Avg sleep: ${avgSleep} h`);
  if (avgPain !== null) lines.push(`- Avg pain: ${avgPain}/10`);
  if (avgSoreness !== null) lines.push(`- Avg soreness: ${avgSoreness}/10`);
  if (avgStress !== null) lines.push(`- Avg stress: ${avgStress}/10`);
  if (notes.length) lines.push(`- Notable notes: ${notes.join(" | ")}`);

  // Simple recommendation heuristics
  const recs: string[] = [];
  if (avgSleep !== null && avgSleep < 6.5) recs.push("Keep workouts moderate; prioritize sleep consistency.");
  if (avgPain !== null && avgPain >= 4) recs.push("Reduce painful ranges; emphasize low-impact and technique.");
  if (avgSteps !== null && avgSteps < 6000) recs.push("Add 1–2 short walks/day to raise baseline activity.");
  if (recs.length) lines.push(`- Coach focus: ${recs.join(" ")}`);

  return lines.join("\n");
}

async function maybeWriteWeeklySummary(args: {
  supabase: any;
  userId: string;
  llmMode: string;
  hasEmbeddingKey: boolean;
}) {
  // Only write if:
  // - at least 3 check-ins exist in last 8 days
  // - no summary written in the last 6 days
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);

  const { data: recentCheckIns } = await args.supabase
    .from("check_ins")
    .select("*")
    .eq("user_id", args.userId)
    .gte("at_date", sinceDate)
    .order("at_date", { ascending: false })
    .limit(8);

  const checkIns = recentCheckIns ?? [];
  if (checkIns.length < 3) return;

  const { data: lastSummary } = await args.supabase
    .from("memories")
    .select("created_at,metadata")
    .eq("user_id", args.userId)
    .eq("kind", "checkin_summary")
    .order("created_at", { ascending: false })
    .limit(1);

  const lastCreated = lastSummary?.[0]?.created_at as string | undefined;
  const lastDate = lastCreated ? isoDateOnly(lastCreated) : null;
  if (lastDate) {
    const last = new Date(lastDate);
    const daysSince = (Date.now() - last.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince < 6) return;
  }

  const summaryText = formatWeeklySummary(checkIns);
  if (!summaryText) return;

  let embedding: number[] | null = null;
  if (args.llmMode !== "mock" && args.hasEmbeddingKey) {
    try {
      embedding = await embedText(summaryText);
    } catch {
      embedding = null;
    }
  }

  await args.supabase.from("memories").insert({
    user_id: args.userId,
    kind: "checkin_summary",
    content: summaryText,
    embedding,
    metadata: { source: "auto_weekly_summary", since_date: sinceDate },
  });
}

function mockCoachReply(args: {
  message: string;
  profile: Record<string, unknown> | null;
  goals: unknown[];
  checkIns: unknown[];
  rememberedNotes: string[];
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  citations: PubmedCitation[];
  sessionState: Record<string, unknown>;
}) {
  const userMsg = args.message.trim();
  const lowerMsg = userMsg.toLowerCase();
  const firstLine = userMsg.split(/\r?\n/)[0]?.trim() ?? "";

  const state = (args.sessionState ?? {}) as Record<string, any>;
  const intake = ensureRecord(state.intake);
  state.intake = intake;

  const group = String((args.profile as any)?.primary_group ?? "general");
  const experience = String((args.profile as any)?.experience_level ?? "beginner");
  const name = String((args.profile as any)?.display_name ?? "there");
  const tone = String(((args.profile as any)?.preferences?.tone as string | undefined) ?? "friendly");

  function parseRequestedMinutes(msg: string): number | null {
    const m = msg.match(/(\d{1,3})\s*(min|mins|minute|minutes)\b/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const requestedMinutes = parseRequestedMinutes(userMsg);

  const latest = (Array.isArray(args.checkIns) ? args.checkIns[0] : null) as any;
  const sleepHours = typeof latest?.sleep_hours === "number" ? latest.sleep_hours : null;
  const steps = typeof latest?.steps === "number" ? latest.steps : null;
  const pain = typeof latest?.pain_score === "number" ? latest.pain_score : null;
  const soreness = typeof latest?.soreness_score === "number" ? latest.soreness_score : null;
  const checkinDate = typeof latest?.at_date === "string" ? latest.at_date : null;
  const notes = typeof latest?.notes === "string" ? latest.notes : null;

  const hasCheckin = Boolean(latest);
  const readinessFlags: string[] = [];
  if (sleepHours !== null && sleepHours < 6.5) readinessFlags.push("low sleep");
  if (pain !== null && pain >= 4) readinessFlags.push("higher pain");
  if (soreness !== null && soreness >= 6) readinessFlags.push("high soreness");

  const intensity =
    readinessFlags.length >= 2 ? "light" : readinessFlags.length === 1 ? "moderate" : "normal";

  const lastAssistantWithOptions = [...(args.recentMessages ?? [])]
    .reverse()
    .find((m) => m.role === "assistant" && m.content.includes("Pick one:"));

  const lastAssistantLimiterQuestion = [...(args.recentMessages ?? [])]
    .reverse()
    .find(
      (m) =>
        m.role === "assistant" &&
        m.content.toLowerCase().includes("which is the bigger limiter"),
    );

  const numericChoice =
    userMsg.match(/^\s*([123])\s*$/)?.[1] ??
    firstLine.match(/^\s*([123])(?:[\)\.\:]|\s|$)/)?.[1] ??
    null;
  let forcedIntent: "plan" | "pain" | "habits" | "nutrition" | null = null;
  if (numericChoice && lastAssistantWithOptions) {
    const optText = lastAssistantWithOptions.content;
    if (optText.includes("Build a beginner plan") && numericChoice === "1") forcedIntent = "plan";
    if (optText.includes("Fix a specific pain") && numericChoice === "2") forcedIntent = "pain";
    if (optText.includes("Improve daily habits") && numericChoice === "3") forcedIntent = "habits";
    if (optText.includes("Simple plate method")) forcedIntent = "nutrition";
  }

  if (forcedIntent) {
    state.selected_intent = forcedIntent;
  }

  // Lightweight intent detection to keep mock replies relevant.
  const wantsAdjustment =
    lowerMsg.includes("adjust") ||
    lowerMsg.includes("check-in") ||
    lowerMsg.includes("check in") ||
    lowerMsg.includes("latest check") ||
    lowerMsg.includes("based on my check") ||
    lowerMsg.includes("based on check") ||
    lowerMsg.includes("today") ||
    lowerMsg.includes("workout");
  const wantsPlan =
    lowerMsg.includes("plan") ||
    lowerMsg.includes("program") ||
    lowerMsg.includes("routine") ||
    lowerMsg.includes("schedule") ||
    lowerMsg.includes("week");
  const wantsNutrition =
    lowerMsg.includes("diet") ||
    lowerMsg.includes("calorie") ||
    lowerMsg.includes("protein") ||
    lowerMsg.includes("nutrition") ||
    lowerMsg.includes("meal");

  const selectedIntent = String(state.selected_intent ?? "");
  const resolvedWantsPlan = forcedIntent === "plan" ? true : wantsPlan || selectedIntent === "plan";
  const resolvedWantsNutrition =
    forcedIntent === "nutrition" ? true : wantsNutrition || selectedIntent === "nutrition";
  const resolvedWantsAdjustment = wantsAdjustment;

  const pendingQuestion = String(state.pending_question ?? "");

  let groupTips = "";
  if (group === "office_worker") {
    groupTips =
      "- 2–5 min movement break every 45–60 min (walk + hip flexor stretch).\n- 2 strength sessions/week minimum (push/pull/legs).\n- Daily step target: +1,000 from your current average.\n";
  } else if (group === "athlete") {
    groupTips =
      "- Keep 1–2 rest or low-load days/week.\n- Track a key performance metric (pace/watts/1RM) + RPE.\n- Prioritize sleep and fueling around hard sessions.\n";
  } else if (group === "older_adult") {
    groupTips =
      "- Strength + balance 2–3x/week (sit-to-stand, step-ups, carries).\n- Keep intensity moderate; progress slowly.\n- Add daily walking and simple mobility for joints.\n";
  } else if (group === "patient") {
    groupTips =
      "- If you have a clinician/physio plan, follow it first.\n- Use a pain rule: stop if pain sharp/worsening or >3/10 during the movement.\n- Focus on gentle strength + low-impact cardio unless cleared otherwise.\n";
  } else {
    groupTips =
      "- Aim for 2–4 workouts/week: full-body strength + light cardio.\n- Increase activity gradually (10%/week rule of thumb).\n- Keep protein/fiber consistent and sleep regular.\n";
  }

  const quick20 = (variant: "light" | "moderate" | "normal") => {
    const base = `20-minute session:\n- 2 min warm-up: marching + hip hinges + arm circles\n- 14 min main (7 moves, 40s work / 20s rest x2 rounds):\n  1) DB RDL (hip hinge)\n  2) Incline push-up or DB floor press\n  3) One-arm DB row (switch sides each round)\n  4) Glute bridge (pause 1s at top)\n  5) Dead bug (slow)\n  6) Split squat to comfortable depth (skip if knee unhappy; do step-ups/box sit-stand)\n  7) Side plank (each side)\n- 4 min cooldown: hip flexor stretch + gentle back/hip mobility\n`;
    if (variant === "light") {
      return (
        base +
        "\nMake it LIGHT today:\n- Work at an easy pace (you should be able to talk).\n- Stop any movement that increases knee/back pain."
      );
    }
    if (variant === "moderate") {
      return (
        base +
        "\nMake it MODERATE today:\n- Aim for RPE ~6/10 on strength moves.\n- Keep split squats shallow and controlled."
      );
    }
    return (
      base +
      "\nMake it NORMAL today:\n- Aim for RPE ~7/10 on strength moves.\n- Add weight only if form stays crisp."
    );
  };

  const workoutStandard = () => {
    if (intensity === "light") {
      return `Light session (25–30 min):\n- Warm-up 5 min\n- 2 rounds (easy pace):\n  - DB RDL x8–10\n  - Incline push-up x8–12\n  - DB row x10/side\n  - Dead bug x6/side\n- Mobility 8 min`;
    }
    if (intensity === "moderate") {
      return `Moderate session (30–40 min):\n- Warm-up 6 min\n- 3 rounds:\n  - DB RDL x8–10\n  - DB floor press x8–12\n  - DB row x10/side\n  - Split squat to comfortable depth x6–8/side\n- Cooldown 5 min`;
    }
    return `Normal session (35–45 min):\n- Warm-up 6 min\n- 4 rounds:\n  - DB RDL x8–10\n  - DB floor press x8–12\n  - DB row x10/side\n  - Squat to a box/bench x8–10 (stop before pain)\n- Cooldown 5 min`;
  };

  const checkinBlock = hasCheckin
    ? `Latest check-in${checkinDate ? ` (${checkinDate})` : ""}:\n- Sleep: ${sleepHours ?? "n/a"} h\n- Steps: ${steps ?? "n/a"}\n- Pain: ${pain ?? "n/a"}/10\n- Soreness: ${soreness ?? "n/a"}/10${notes ? `\n- Notes: ${notes}` : ""}\n\nAdjustment:\n- Intensity today: ${intensity}${readinessFlags.length ? ` (because: ${readinessFlags.join(", ")})` : ""}\n`
    : "No check-in found yet. Add one in the Check-in page, then ask again.\n";

  const rememberedBlock =
    args.rememberedNotes.length && (resolvedWantsPlan || resolvedWantsAdjustment || resolvedWantsNutrition)
      ? `Remembered: ${args.rememberedNotes[0]}\n\n`
      : "";

  const safety =
    "If you have chest pain, fainting, severe shortness of breath, new neurological symptoms, or severe injury pain, seek urgent medical care. I can help with general fitness guidance but can’t diagnose conditions.";

  // Keep citations out of the reply body in mock mode to avoid duplicates
  // (the web client already appends citations when present).
  const citationsBlock = "";

  const quickQuestions: string[] = [];
  if (resolvedWantsPlan && !resolvedWantsAdjustment) {
    const missingDays = intake.days_per_week == null;
    const missingMinutes = intake.session_minutes == null;
    if (missingDays && missingMinutes) {
      quickQuestions.push("How many days/week do you want to train (and how long per session)?");
    } else if (missingDays) {
      quickQuestions.push("How many days/week do you want to train?");
    } else if (missingMinutes) {
      quickQuestions.push("How long per session (minutes)?");
    }
    if (intake.injuries == null) quickQuestions.push("Any injuries or movements you want to avoid?");
    if (intake.equipment == null) quickQuestions.push("What equipment do you have available?");
  } else if (resolvedWantsNutrition) {
    if (intake.nutrition_goal == null) {
      quickQuestions.push("What’s your goal (fat loss, muscle gain, performance, general health)?");
    }
    if (intake.dietary_restrictions == null) {
      quickQuestions.push("Any dietary preferences/restrictions (halal/vegetarian/allergies)?");
    }
    if (intake.meals_per_day == null) quickQuestions.push("How many meals/snacks do you prefer per day?");
  } else if (!resolvedWantsAdjustment) {
    if (intake.outcome_2_4_weeks == null) quickQuestions.push("What’s the #1 outcome you want in the next 2–4 weeks?");
    if (intake.days_per_week == null) quickQuestions.push("How many days/week can you realistically commit?");
  }

  const optionsBlock = resolvedWantsAdjustment
    ? `Pick one:\n1) “Quick” (20 min)\n2) “Standard” (35 min)\n3) “Mobility-only” (15 min)`
    : resolvedWantsNutrition
      ? `Pick one:\n1) Simple plate method\n2) Macro targets (protein/carbs/fat)\n3) Meal template + grocery list`
      : `Pick one:\n1) Build a beginner plan\n2) Fix a specific pain/movement issue\n3) Improve daily habits (steps/sleep/posture)`;

  let main = "";
  const limiterPending =
    pendingQuestion === "limiter" ||
    pendingQuestion === "caffeine_time" ||
    pendingQuestion === "bedtime_dose" ||
    pendingQuestion === "wake_time";
  const isLimiterFollowup =
    limiterPending ||
    (Boolean(lastAssistantLimiterQuestion) &&
      forcedIntent === null &&
      !resolvedWantsAdjustment &&
      !resolvedWantsNutrition &&
      !numericChoice);

  if (isLimiterFollowup) {
    state.selected_intent = state.selected_intent ?? "plan";
    const limiter = ensureRecord(state.limiter);
    state.limiter = limiter;

    const wantsBack = Boolean(limiter.back);
    const wantsSleep = Boolean(limiter.sleep);
    const wantsTime = Boolean(limiter.time);
    const wantsKnee = Boolean(limiter.knee);

    const backMods =
      "- For DB RDL: shorten range, brace, and stop 2 reps before form breaks.\n- Swap split squats for step-ups or box sit-to-stands if back feels cranky.\n- Add 2-min decompression: child's pose breathing or gentle knees-to-chest.\n";
    const sleepMods =
      "- 10-min wind-down: dim lights + phone away.\n- If you wake at night: 2 minutes slow nasal breathing (4s in / 6s out).\n";

    const saidCant = lowerMsg.includes("can't") || lowerMsg.includes("cannot");
    const caffeinePlan =
      "Caffeine plan (keep your 3pm, but make sleep easier):\n" +
      "- Keep caffeine at 3pm for now, but reduce the dose: half-caf or a smaller cup.\n" +
      "- No caffeine after 3pm.\n" +
      "- Add a 2-minute energy reset at ~2:30pm (brisk walk + water) to rely less on caffeine.\n" +
      "- If you still need a warm drink later: switch to decaf/tea without caffeine.\n" +
      "- Optional taper: move the last caffeine 15–30 min earlier every 3–4 days.\n";

    const taper =
      "7-day taper (no drastic crash):\n" +
      "- Days 1–3: keep 3pm, but switch to half-caf OR 1 shot.\n" +
      "- Days 4–7: move it to 2:30pm (same reduced dose).\n" +
      "- If sleep improves: keep there; if not: move to 2:00pm.\n";

    const sleepPlan =
      "Sleep plan tonight (15 minutes total):\n" +
      "- 5 min: prep (water, tidy desk/room, lights dim).\n" +
      "- 8 min: slow breathing (4s in / 6s out) or a short body scan.\n" +
      "- 2 min: write down tomorrow’s top 3 tasks (gets it out of your head).\n";

    const backMicro =
      "Back micro-reset (3 minutes, anytime):\n" +
      "- 30s: hip flexor stretch each side\n" +
      "- 60s: child’s pose breathing (slow)\n" +
      "- 30s: glute bridge hold x2\n";

    const pending = pendingQuestion || "limiter";
    if (pending === "limiter") {
      const back = lowerMsg.includes("back");
      const sleep = lowerMsg.includes("sleep");
      const time = lowerMsg.includes("time");
      const knee = lowerMsg.includes("knee");
      if (!back && !sleep && !time && !knee) {
        state.pending_question = "limiter";
        main = "Which is the bigger limiter right now: knee, back, sleep, or time?";
      } else {
        limiter.back = back;
        limiter.sleep = sleep;
        limiter.time = time;
        limiter.knee = knee;
        const label = [back ? "back" : null, sleep ? "sleep" : null, time ? "time" : null, knee ? "knee" : null]
          .filter(Boolean)
          .join(" + ") || "your limiter";
        state.pending_question = "caffeine_time";
        main =
          `Nice — we’ll optimize for ${label}.\n\n` +
          "Do this for the next 7 days (simple + flexible):\n" +
          "- 2x/week: 10-minute strength snack\n" +
          "- Daily: 5-minute energy reset\n" +
          "- Tonight: 10-min wind-down\n\n" +
          (back ? `Back-friendly tweaks:\n${backMods}\n` : "") +
          (sleep ? `Sleep tweaks:\n${sleepMods}\n` : "") +
          "One question: what time is your last caffeine (coffee/tea) most days?";
      }
    } else if (pending === "caffeine_time") {
      const caffeineTime =
        parseTimeOfDay(userMsg, "pm") ?? (lowerMsg.includes("no caffeine") ? "none" : null);
      if (!caffeineTime) {
        limiter.caffeine_time_raw = firstLine.slice(0, 120) || firstNonEmptyLine(userMsg).slice(0, 120);
        state.pending_question = "bedtime_dose";
        main =
          "Got it — I’ll treat that as your typical last caffeine time.\n\n" +
          "\nQuick follow-up: what time do you usually go to bed, and how many cups (or how strong) is your caffeine?";
      } else {
        limiter.caffeine_time = caffeineTime;
        state.pending_question = "bedtime_dose";
        main =
          `Got it — ${saidCant ? "we won’t force you to quit caffeine." : "we can work with that."}\n\n` +
          caffeinePlan +
          (wantsSleep ? `\nSleep support tonight:\n${sleepMods}` : "") +
          (wantsBack ? `\nBack support today:\n${backMods}` : "") +
          "\nQuick follow-up: what time do you usually go to bed, and how many cups (or how strong) is your caffeine?";
      }
    } else if (pending === "bedtime_dose") {
      limiter.bedtime_and_dose = firstLine.slice(0, 240);
      state.pending_question = "wake_time";
      main =
        `Thanks — ${firstLine ? `noted: ${firstLine}.` : "noted."}\n\n` +
        "One question: what time do you need to wake up on weekdays?";
    } else {
      const wake = parseTimeOfDay(userMsg, "am");
      if (!wake) {
        limiter.wake_time_raw = firstLine.slice(0, 120) || firstNonEmptyLine(userMsg).slice(0, 120);
        delete state.pending_question;
        main =
          "Thanks — noted.\n\n" +
          "Here’s what to do next:\n" +
          taper +
          "\n" +
          sleepPlan +
          (wantsBack ? `\n${backMicro}` : "");
      } else {
        limiter.wake_time = wake;
        delete state.pending_question;
        main =
          `Weekday wake time: ${wake}.\n\n` +
          "Here’s what to do next:\n" +
          taper +
          "\n" +
          sleepPlan +
          (wantsBack ? `\n${backMicro}` : "");
      }
    }

    // In limiter follow-up mode, don't show generic menu/questions.
    quickQuestions.length = 0;
  } else if (resolvedWantsAdjustment) {
    const timeBoxed = requestedMinutes !== null && requestedMinutes <= 25;
    const workout =
      timeBoxed || requestedMinutes === 20 ? quick20(intensity) : workoutStandard();
    main = `${checkinBlock}Do this today:\n${workout}`;
  } else if (resolvedWantsNutrition) {
    main =
      "Here’s a simple starting point you can apply today:\n- Protein: include a palm-sized serving each meal\n- Veg/fiber: 1–2 fists of veg/fruit per meal\n- Hydration: 2–3L/day (adjust for sweat)\n- If fat loss: keep portions consistent for 7 days before changing\n";
  } else if (resolvedWantsPlan) {
    main =
      "I can build a plan, but first I’ll propose a safe default you can start today:\n- 3 days/week full-body strength (RPE ~6–7)\n- 2 short walks on non-lifting days (10–20 min)\n- 5-min daily mobility\n";
  } else {
    main =
      "Got it. Here’s the smallest useful next step:\n- Tell me your goal + schedule, and I’ll propose a plan you can approve.\n";
  }

  if (resolvedWantsPlan) {
    const lowCommit =
      lowerMsg.includes("can't") ||
      lowerMsg.includes("cannot") ||
      lowerMsg.includes("hard") ||
      lowerMsg.includes("busy") ||
      lowerMsg.includes("not sure") ||
      lowerMsg.includes("can't really promise") ||
      lowerMsg.includes("cannot promise") ||
      lowerMsg.includes("can't promise");

    if (lowCommit) {
      main =
        "Beginner plan (minimum effective dose, flexible):\n- 2x/week “10-minute strength snack” (pick any 2 days):\n  - DB RDL x10\n  - Incline push-up x8–12\n  - DB row x10/side\n  - Repeat once (2 rounds)\n- Daily: 5-minute “energy reset” (walk + hip flexor stretch + 4 slow breaths)\n- Tonight: no caffeine after lunch + 10-min wind-down (lights low)\n\nReply “knee” or “back” if you want me to tailor the moves.\n";

      // In low-commit mode, don't ask for a full schedule yet.
      quickQuestions.length = 0;
      quickQuestions.push("Which is the bigger limiter right now: knee, back, sleep, or time?");
      state.selected_intent = state.selected_intent ?? "plan";
      state.pending_question = "limiter";
    }
  }

  const questionsBlock = quickQuestions.length
    ? `\nQuick questions (reply with short answers):\n- ${quickQuestions.join("\n- ")}`
    : "";

  const opening =
    requestedMinutes !== null
      ? `You’ve got ${requestedMinutes} minutes — here’s the fastest useful plan.`
      : "Got it — here’s the fastest useful next step.";

  const voicePrefix = tone === "strict" ? "" : `Hi ${name}. `;
  const modeNote =
    tone === "brief"
      ? `\n\n(Note: mock mode • v${COACH_FUNCTION_VERSION})`
      : `\n\nNote: mock mode (no paid LLM/API calls) • v${COACH_FUNCTION_VERSION}.`;

  const safetyBlock =
    tone === "brief" ? "" : `\n\nSafety:\n- ${safety}`;

  // If the user already picked from a menu (forcedIntent), don't show that same menu again.
  const shouldShowOptions =
    !isLimiterFollowup &&
    !pendingQuestion &&
    !state.selected_intent &&
    forcedIntent === null &&
    !resolvedWantsPlan &&
    !resolvedWantsNutrition &&
    !resolvedWantsAdjustment;
  const optionsSection = shouldShowOptions ? `\n\n${optionsBlock}` : "";

  return `${voicePrefix}${opening}\n\n${rememberedBlock}${main}${optionsSection}${questionsBlock}${safetyBlock}${citationsBlock}${modeNote}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    const supabase = createUserSupabaseClient(authHeader);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const payload = (await req.json()) as CoachRequest;
    const message = (payload.message ?? "").trim();
    if (!message) return jsonResponse({ error: "Missing message" }, 400);

    // Ensure session
    let sessionId = payload.session_id;
    if (!sessionId) {
      const title = message.length > 60 ? `${message.slice(0, 57)}...` : message;
      const { data: session, error } = await supabase
        .from("chat_sessions")
        .insert({ user_id: userId, title })
        .select("id")
        .single();
      if (error) throw error;
      sessionId = session.id as string;
    }

    // Persist user message
    {
      const { error } = await supabase.from("chat_messages").insert({
        session_id: sessionId,
        user_id: userId,
        role: "user",
        content: message,
      });
      if (error) throw error;
    }

    // Load context
    const [{ data: profile }, { data: goals }, { data: latestCheckins }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("goals").select("*").eq("user_id", userId).eq("is_active", true).order("created_at", { ascending: false }).limit(5),
      supabase.from("check_ins").select("*").eq("user_id", userId).order("at_date", { ascending: false }).limit(7),
    ]);

    // Retrieve relevant memories
    let rememberedNotes: Array<{ content: string; similarity: number }> = [];
    try {
      const qEmbedding = await embedText(message);
      const { data: matches } = await supabase.rpc("match_memories", {
        p_user_id: userId,
        p_query_embedding: qEmbedding,
        p_match_threshold: 0.75,
        p_match_count: 8,
      });
      rememberedNotes = (matches ?? []).map((m: any) => ({
        content: m.content,
        similarity: m.similarity,
      }));

      // Store this user message as a memory item to improve future personalization
      await supabase.from("memories").insert({
        user_id: userId,
        kind: "freeform",
        content: message,
        embedding: qEmbedding,
        metadata: { role: "user", session_id: sessionId },
      });
    } catch {
      // If embeddings fail, continue without semantic recall.
      const keywords = message
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 5)
        .slice(0, 5);
      if (keywords.length) {
        const q = keywords.map((k) => `%${k}%`);
        const { data: fallback } = await supabase
          .from("memories")
          .select("content,created_at")
          .eq("user_id", userId)
          .or(q.map((x) => `content.ilike.${x}`).join(","))
          .order("created_at", { ascending: false })
          .limit(8);
        rememberedNotes = (fallback ?? []).map((m: any) => ({ content: m.content, similarity: 0 }));
      }

      await supabase.from("memories").insert({
        user_id: userId,
        kind: "freeform",
        content: message,
        embedding: null,
        metadata: { role: "user", session_id: sessionId, note: "no_embedding" },
      });
    }

    // Evidence (PubMed)
    let citations: PubmedCitation[] = [];
    if (shouldFetchEvidence(message, payload.include_evidence)) {
      const query = `${message} exercise training`;
      citations = await searchPubMed(query, 3);

      // Cache evidence docs for this user (best-effort)
      for (const c of citations) {
        const normalizedUrl = c.url;
        const publishedAt = pubdateToDate(c.pubdate);
        const { data: doc, error: docError } = await supabase
          .from("evidence_docs")
          .upsert(
            {
              user_id: userId,
              url: c.url,
              normalized_url: normalizedUrl,
              title: c.title,
              publisher: "PubMed",
              published_at: publishedAt,
              excerpt: c.source ? `Journal: ${c.source}` : null,
              metadata: { pmid: c.pmid, pubdate: c.pubdate, source: c.source },
            },
            { onConflict: "user_id,normalized_url" },
          )
          .select("id")
          .single();
        if (docError || !doc?.id) continue;

        await supabase.from("evidence_citations").insert({
          user_id: userId,
          evidence_doc_id: doc.id,
          used_in: "chat_response",
          quote: null,
          notes: `PubMed ${c.pmid}`,
        });
      }
    }

    // Load recent messages for conversational continuity
    const { data: recentMsgs } = await supabase
      .from("chat_messages")
      .select("role,content,created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(12);

    const recent = (recentMsgs ?? []).reverse().map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content as string,
    }));

    // Load per-session state (used by mock mode to avoid repeating menus/questions).
    const { data: sessionRow } = await supabase
      .from("chat_sessions")
      .select("state")
      .eq("id", sessionId)
      .maybeSingle();
    const sessionState = ((sessionRow as any)?.state ?? {}) as Record<string, unknown>;

    const memoryBlock = rememberedNotes.length
      ? `\nRemembered notes (highest relevance first):\n${rememberedNotes
          .slice(0, 8)
          .map((n) => `- ${n.content}`)
          .join("\n")}\n`
      : "";

    updateSessionStateFromUserMessage({ message, recentMessages: recent, sessionState });

    const contextBlock =
      `User profile (JSON):\n${JSON.stringify(profile ?? {}, null, 2)}\n\n` +
      `Active goals (JSON):\n${JSON.stringify(goals ?? [], null, 2)}\n\n` +
      `Recent check-ins (JSON):\n${JSON.stringify(latestCheckins ?? [], null, 2)}\n\n` +
      `Chat session state (JSON):\n${JSON.stringify(sessionState ?? {}, null, 2)}\n` +
      `${memoryBlock}${buildEvidenceBlock(citations)}`;

    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt() },
      { role: "system", content: contextBlock },
      ...recent,
    ];

    const mode = llmMode();
    const llmOk = hasLlmKey();
    const embeddingOk = hasEmbeddingKey();

    // Periodically write a weekly summary of check-ins into memories (best-effort).
    try {
      await maybeWriteWeeklySummary({
        supabase,
        userId,
        llmMode: mode,
        hasEmbeddingKey: embeddingOk,
      });
    } catch {
      // best-effort
    }

    let reply: string;
    if (mode === "mock" || !llmOk) {
      reply = mockCoachReply({
        message,
        profile: (profile as any) ?? null,
        goals: (goals as any) ?? [],
        checkIns: (latestCheckins as any) ?? [],
        rememberedNotes: rememberedNotes.map((n) => n.content),
        recentMessages: recent,
        citations,
        sessionState,
      });
    } else {
      try {
        reply = await generateCoachReply(messages);
      } catch (llmErr) {
        console.error("LLM call failed, falling back to mock:", llmErr);
        reply = mockCoachReply({
          message,
          profile: (profile as any) ?? null,
          goals: (goals as any) ?? [],
          checkIns: (latestCheckins as any) ?? [],
          rememberedNotes: rememberedNotes.map((n) => n.content),
          recentMessages: recent,
          citations,
          sessionState,
        });
      }
    }

    try {
      await supabase.from("chat_sessions").update({ state: sessionState }).eq("id", sessionId);
    } catch {
      // best-effort
    }

    // Persist assistant message
    {
      const { error } = await supabase.from("chat_messages").insert({
        session_id: sessionId,
        user_id: userId,
        role: "assistant",
        content: reply,
      });
      if (error) throw error;
    }

    return jsonResponse({
      session_id: sessionId,
      reply,
      citations,
      version: COACH_FUNCTION_VERSION,
    });
  } catch (err) {
    return jsonResponse({ error: String(err?.message ?? err) }, 500);
  }
});
