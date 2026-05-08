interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChatChoice {
  index: number;
  message: { role: string; content: string };
  finish_reason: string;
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  choices: OpenAIChatChoice[];
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

const LLM_TIMEOUT_MS = 55_000;

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function getLLMBaseUrl() {
  const provider = (Deno.env.get("LLM_PROVIDER") ?? "openai").toLowerCase();
  if (provider === "deepseek") return Deno.env.get("LLM_BASE_URL") ?? "https://api.deepseek.com";
  return Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
}

function getLLMApiKey(): string {
  const key = Deno.env.get("LLM_API_KEY") || Deno.env.get("DEEPSEEK_API_KEY") || Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("Missing LLM_API_KEY, DEEPSEEK_API_KEY, or OPENAI_API_KEY env var");
  return key;
}

function getLLMChatModel(): string {
  return Deno.env.get("LLM_CHAT_MODEL") || Deno.env.get("DEEPSEEK_CHAT_MODEL") || Deno.env.get("OPENAI_CHAT_MODEL") || "deepseek-v4-flash";
}

export function hasLLMKey(): boolean {
  return !!(Deno.env.get("LLM_API_KEY") || Deno.env.get("DEEPSEEK_API_KEY") || Deno.env.get("OPENAI_API_KEY"));
}

export async function generateCoachReply(messages: ChatMessage[]): Promise<string> {
  const model = getLLMChatModel();
  const res = await fetchWithTimeout(
    `${getLLMBaseUrl()}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getLLMApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages: messages as any, temperature: 0.5 }),
    },
    LLM_TIMEOUT_MS
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Chat failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as OpenAIChatResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Chat response missing content");
  return content.trim();
}

export async function embedText(text: string): Promise<number[]> {
  const model = "text-embedding-3-small";
  const res = await fetchWithTimeout(
    `${getLLMBaseUrl()}/embeddings`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getLLMApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: text }),
    },
    LLM_TIMEOUT_MS
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding failed: ${res.status} ${body}`);
  }
  const json = (await res.json()) as OpenAIEmbeddingResponse;
  return json.data[0].embedding;
}
