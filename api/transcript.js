// Link -> transcript, using Supadata (https://docs.supadata.ai).
import { json, fail, readJson, env, checkAccess, errorMessage } from "./_lib.js";

const BASE = "https://api.supadata.ai/v1";

async function supa(path) {
  const res = await fetch(BASE + path, { headers: { "x-api-key": env("SUPADATA_API_KEY") } });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { status: res.status, ok: res.ok, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalise(content) {
  if (!Array.isArray(content)) return [];
  return content
    .map((c) => ({
      text: String(c.text || "").replace(/\s+/g, " ").trim(),
      start: (Number(c.offset) || 0) / 1000,
      dur: (Number(c.duration) || 0) / 1000,
    }))
    .filter((c) => c.text);
}

export async function POST(request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!env("SUPADATA_API_KEY")) return fail("SUPADATA_API_KEY is not set in Vercel.", 500);

  const { url, lang } = await readJson(request);
  if (!url || !/^https?:\/\//i.test(url)) return fail("Paste a full video link that starts with http.");

  try {
    const q = new URLSearchParams({ url, text: "false", mode: "auto" });
    if (lang) q.set("lang", lang);
    let r = await supa(`/transcript?${q}`);

    // Long or caption-less videos come back as a job to poll.
    if (r.status === 202 && r.data.jobId) {
      const jobId = r.data.jobId;
      const until = Date.now() + 50_000;
      while (Date.now() < until) {
        await sleep(2500);
        r = await supa(`/transcript/${encodeURIComponent(jobId)}`);
        const s = r.data.status;
        if (s === "completed") break;
        if (s === "failed") return fail("No captions and none could be made for this video.", 422);
      }
      if (r.data.status !== "completed") {
        return json({ pending: true, jobId }, 202);
      }
    }

    if (!r.ok) {
      const msg = r.data.message || r.data.error || `Supadata said ${r.status}`;
      return fail(r.status === 404 ? "No captions and none could be made for this video." : msg, r.status);
    }
    const segments = normalise(r.data.content);
    if (!segments.length) return fail("No captions and none could be made for this video.", 422);
    return json({ lang: r.data.lang || lang || "en", segments });
  } catch (err) {
    return fail(errorMessage(err), 500);
  }
}

// Lets the page keep polling a long transcript job.
export async function GET(request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return fail("Missing jobId");
  const r = await supa(`/transcript/${encodeURIComponent(jobId)}`);
  if (r.data.status === "completed") {
    return json({ lang: r.data.lang || "en", segments: normalise(r.data.content) });
  }
  if (r.data.status === "failed") return fail("No captions and none could be made for this video.", 422);
  return json({ pending: true, jobId }, 202);
}
