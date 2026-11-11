// Small client for the Upload-Post API (https://docs.upload-post.com).
import { env } from "./_lib.js";

const BASE = "https://api.upload-post.com/api";

export const PLATFORMS = ["tiktok", "instagram", "youtube", "facebook", "x"];

export function uploadPostUser() {
  return env("UPLOADPOST_USER") || "clip-cutter";
}

export async function upost(path, { method = "GET", json, form } = {}) {
  const headers = { Authorization: `Apikey ${env("UPLOADPOST_API_KEY")}` };
  let body;
  if (json) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const res = await fetch(BASE + path, { method, headers, body });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

// Makes sure the Upload-Post profile exists. A 409 means it already does.
export async function ensureProfile() {
  const user = uploadPostUser();
  const got = await upost(`/uploadposts/users/${encodeURIComponent(user)}`);
  if (got.ok && got.data.profile) return got.data.profile;
  const made = await upost("/uploadposts/users", {
    method: "POST",
    json: { username: user, display_name: "Clip Cutter" },
  });
  if (made.ok || made.status === 409) {
    const again = await upost(`/uploadposts/users/${encodeURIComponent(user)}`);
    if (again.ok) return again.data.profile;
  }
  throw new Error(made.data.message || `Upload-Post said ${made.status}`);
}

export function friendlyUploadError(status, data) {
  const msg = (data && (data.message || data.error)) || "";
  if (status === 401) return "Upload-Post rejected the API key. Check UPLOADPOST_API_KEY.";
  if (status === 429 || /limit/i.test(msg)) return "Your Upload-Post monthly upload limit is used up.";
  return msg || `Upload-Post said ${status}`;
}
