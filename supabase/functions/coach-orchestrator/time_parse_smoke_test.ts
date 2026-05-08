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

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: expected ${String(expected)} got ${String(actual)}`);
  }
}

assertEqual(parseTimeOfDay("3pm", "pm"), "3pm");
assertEqual(parseTimeOfDay("3 pm", "pm"), "3pm");
assertEqual(parseTimeOfDay("14:00", "pm"), "14:00");
assertEqual(parseTimeOfDay("3", "pm"), "3pm");
assertEqual(parseTimeOfDay("Usually around 3", "pm"), "3pm");
assertEqual(parseTimeOfDay("Usually in the early evening", "pm"), "6pm");
assertEqual(parseTimeOfDay("7", "am"), "7am");
assertEqual(parseTimeOfDay("7", undefined), null);

console.log("ok");
