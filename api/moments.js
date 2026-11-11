// Transcript -> the best moments, with hooks, captions and scores (Claude).
import Anthropic from "@anthropic-ai/sdk";
import { json, fail, readJson, env, checkAccess } from "./_lib.js";

const MODEL = () => env("CLAUDE_MODEL") || "claude-sonnet-5-5";

const LENGTHS = {
  auto: [15, 90],
  short: [10, 30],
  medium: [30, 60],
  long: [60, 90],
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clips"],
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "hook", "start", "end", "scores", "reason", "caption", "hashtags", "keywords"],
        properties: {
          title: { type: "string", description: "Short internal name for the clip, max 8 words." },
          hook: { type: "string", description: "On-screen hook title for the first seconds, max 9 words." },
          start: { type: "number", description: "Start time in seconds. Must be a sentence start from the transcript." },
          end: { type: "number", description: "End time in seconds. Must end on a finished thought." },
          scores: {
            type: "object",
            additionalProperties: false,
            required: ["hook", "flow", "value", "shareability"],
            properties: {
              hook: { type: "integer", description: "0-99: do the first 3 seconds stop the scroll?" },
              flow: { type: "integer", description: "0-99: does it make sense on its own, with a clean start and end?" },
              value: { type: "integer", description: "0-99: is it funny, surprising, useful or emotional?" },
              shareability: { type: "integer", description: "0-99: would people send it to a friend or argue in the comments?" },
            },
          },
          reason: { type: "string", description: "One sentence on why this moment works." },
          caption: { type: "string", description: "Ready-to-post caption, 1-2 sentences, no hashtags." },
          hashtags: { type: "array", items: { type: "string" }, description: "3-6 hashtags without the # sign." },
          keywords: {
            type: "array",
            description: "4-10 words spoken in this clip worth emphasising on screen.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["word", "emoji"],
              properties: {
                word: { type: "string", description: "A single word exactly as spoken." },
                emoji: { type: "string", description: "One fitting emoji, or an empty string for none." },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You are an expert short-form video editor. You find the moments in a long video that will perform best as standalone vertical clips on TikTok, Instagram Reels and YouTube Shorts.

A great clip:
- opens with a strong line within the first 3 seconds (a bold claim, a question, a reveal, a laugh)
- makes sense to someone who has not seen the rest of the video
- ends on a payoff or finished thought, never mid-sentence
- is funny, surprising, controversial, emotional or genuinely useful

Use only the timestamps in the transcript. Clips must not overlap. Rate honestly: most moments are not 90+. Write hooks and captions in the same language as the transcript.`;

function toTimestampedText(segments) {
  return segments.map((s) => `[${s.start.toFixed(1)}] ${s.text}`).join("\n");
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export async function POST(request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!env("ANTHROPIC_API_KEY")) return fail("ANTHROPIC_API_KEY is not set in Vercel.", 500);

  const body = await readJson(request);
  const segments = Array.isArray(body.segments) ? body.segments : [];
  if (!segments.length) return fail("No transcript to read.");
  const [minLen, maxLen] = LENGTHS[body.length] || LENGTHS.auto;
  const count = clamp(Number(body.count) || 8, 1, 20);
  const focus = String(body.focus || "").slice(0, 300);
  const total = segments.reduce((m, s) => Math.max(m, (s.start || 0) + (s.dur || 0)), 0);

  const userPrompt = [
    `Find up to ${count} clips, each ${minLen}-${maxLen} seconds long.`,
    focus ? `The creator wants: ${focus}` : "",
    `The video is about ${Math.round(total)} seconds long. Transcript, one line per caption, with start time in seconds:`,
    "",
    toTimestampedText(segments),
  ]
    .filter(Boolean)
    .join("\n");

  const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });

  let message;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL(),
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return fail("Claude rejected ANTHROPIC_API_KEY.", 500);
    if (err instanceof Anthropic.RateLimitError) return fail("Claude is busy. Try again in a minute.", 429);
    if (err instanceof Anthropic.BadRequestError) return fail(`Claude: ${err.message}`, 400);
    if (err instanceof Anthropic.APIError) return fail(`Claude error ${err.status}: ${err.message}`, 502);
    return fail(`Could not reach Claude: ${err.message}`, 502);
  }

  if (message.stop_reason === "refusal") {
    return fail("Claude declined to clip this video.", 422);
  }
  if (message.stop_reason === "max_tokens") {
    return fail("The answer was cut off. Ask for fewer clips.", 422);
  }

  const text = message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("Claude's answer could not be read. Try again.", 502);
  }

  const clips = (parsed.clips || [])
    .map((c, i) => {
      const start = clamp(Number(c.start) || 0, 0, total);
      let end = clamp(Number(c.end) || 0, 0, total + 1);
      if (end - start > maxLen + 15) end = start + maxLen;
      const s = c.scores || {};
      const sub = {
        hook: clamp(s.hook | 0, 0, 99),
        flow: clamp(s.flow | 0, 0, 99),
        value: clamp(s.value | 0, 0, 99),
        shareability: clamp(s.shareability | 0, 0, 99),
      };
      const score = Math.round(sub.hook * 0.35 + sub.flow * 0.2 + sub.value * 0.25 + sub.shareability * 0.2);
      return {
        id: `c${Date.now().toString(36)}${i}`,
        title: String(c.title || `Clip ${i + 1}`),
        hook: String(c.hook || ""),
        start,
        end,
        score,
        scores: sub,
        reason: String(c.reason || ""),
        caption: String(c.caption || ""),
        hashtags: (c.hashtags || []).map((h) => String(h).replace(/^#/, "")).filter(Boolean),
        keywords: (c.keywords || []).filter((k) => k && k.word),
      };
    })
    .filter((c) => c.end - c.start >= 3)
    .sort((a, b) => b.score - a.score);

  return json({ clips, model: message.model });
}
