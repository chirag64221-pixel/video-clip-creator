// Posts a clip (already in Blob storage) to the accounts you picked.
import { json, fail, readJson, env, checkAccess, errorMessage } from "./_lib.js";
import { upost, uploadPostUser, PLATFORMS, friendlyUploadError } from "./_upost.js";

const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
const YT_PRIVACY = ["public", "unlisted", "private"];

function isOurBlob(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function POST(request) {
  const denied = checkAccess(request, { required: true });
  if (denied) return denied;
  if (!env("UPLOADPOST_API_KEY")) return fail("UPLOADPOST_API_KEY is not set in Vercel.", 500);

  const b = await readJson(request);
  const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p) => PLATFORMS.includes(p));
  if (!platforms.length) return fail("Pick at least one account to post to.");
  if (!isOurBlob(b.videoUrl)) return fail("The clip must be uploaded to your Blob store first.");

  const title = String(b.title || "").slice(0, 100) || "New clip";
  const caption = String(b.caption || "").slice(0, 2200);

  let when = null;
  if (b.scheduleAt) {
    when = new Date(b.scheduleAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
      return fail("Pick a schedule time at least a minute from now.");
    }
  }

  // YouTube needs a short title; the other apps use the title field as the post text.
  // So YouTube goes in its own request.
  const groups = [];
  const others = platforms.filter((p) => p !== "youtube");
  if (others.length) groups.push({ platforms: others, title: caption || title });
  if (platforms.includes("youtube")) groups.push({ platforms: ["youtube"], title });

  const makeForm = (g) => {
    const form = new FormData();
    form.append("user", uploadPostUser());
    for (const p of g.platforms) form.append("platform[]", p);
    form.append("video", b.videoUrl);
    form.append("title", g.title);
    form.append("description", caption);
    form.append("async_upload", "true");
    if (g.platforms.includes("tiktok") && TIKTOK_PRIVACY.includes(b.tiktokPrivacy)) form.append("privacy_level", b.tiktokPrivacy);
    if (g.platforms.includes("youtube") && YT_PRIVACY.includes(b.youtubePrivacy)) form.append("privacyStatus", b.youtubePrivacy);
    if (when) form.append("scheduled_date", when.toISOString());
    return form;
  };

  try {
    const sent = [];
    for (const g of groups) {
      const r = await upost("/upload", { method: "POST", form: makeForm(g) });
      if (!r.ok) {
        return fail(friendlyUploadError(r.status, r.data), r.status === 429 ? 429 : 502, { sent });
      }
      sent.push({
        platforms: g.platforms,
        requestId: r.data.request_id || null,
        jobId: r.data.job_id || null,
        results: r.data.results || null,
      });
    }
    return json({ scheduled: Boolean(when), sent });
  } catch (err) {
    return fail(errorMessage(err), 502);
  }
}
