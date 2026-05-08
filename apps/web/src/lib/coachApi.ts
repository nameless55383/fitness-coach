const FUNCTION_URL =
  process.env.NEXT_PUBLIC_COACH_FUNCTION_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_URL ??
  "http://localhost:54321/functions/v1/coach-orchestrator";

const TIMEOUT_MS = 60_000;

function timeoutSignal(ms: number): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

export interface CoachReply {
  reply: string;
  session_id: string;
  citations: Array<{ title: string; url: string; snippet: string }>;
}

export async function sendCoachMessage(opts: {
  message: string;
  sessionId?: string;
  includeEvidence: boolean;
  accessToken: string;
}): Promise<CoachReply> {
  const { message, sessionId, includeEvidence, accessToken } = opts;

  const body: Record<string, unknown> = { message };
  if (sessionId) body.session_id = sessionId;
  body.include_evidence = includeEvidence;

  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    signal: timeoutSignal(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`Coach API error (${res.status}): ${text}`);
  }

  return res.json();
}
