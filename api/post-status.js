// Checks whether a post went through. Once it's finished, deletes the stored clip.
import { del } from "@vercel/blob";
import { json, fail, env, checkAccess, errorMessage } from "./_lib.js";
import { upost } from "./_upost.js";

const DONE = ["completed", "failed"];

export async function GET(request) {
  const denied = checkAccess(request, { required: true });
  if (denied) return denied;
  const q = new URL(request.url).searchParams;
  const requestId = q.get("requestId");
  const blobUrl = q.get("blobUrl");
  if (!requestId) return fail("Missing requestId");

  try {
    const r = await upost(`/uploadposts/status?request_id=${encodeURIComponent(requestId)}`);
    if (!r.ok && r.status !== 404) return fail(r.data.message || `Upload-Post said ${r.status}`, 502);
    const status = r.status === 404 ? "pending" : r.data.status || "pending";
    const results = (r.data.results || []).map((x) => ({
      platform: x.platform,
      success: Boolean(x.success),
      message: x.message || x.error || "",
      url: x.post_url || x.url || "",
    }));
    let deleted = false;
    if (DONE.includes(status) && blobUrl && env("BLOB_READ_WRITE_TOKEN")) {
      try {
        const u = new URL(blobUrl);
        if (u.hostname.endsWith(".blob.vercel-storage.com")) {
          await del(blobUrl);
          deleted = true;
        }
      } catch {
        deleted = false;
      }
    }
    return json({ status, results, done: DONE.includes(status), deleted });
  } catch (err) {
    return fail(errorMessage(err), 502);
  }
}
