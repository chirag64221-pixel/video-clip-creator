// Shared helpers for the API routes.
import { timingSafeEqual } from "node:crypto";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function fail(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export const env = (name) => (process.env[name] || "").trim();

export function hasAccessCode() {
  return env("ACCESS_CODE").length > 0;
}

// Constant-time comparison of the code the page sends against ACCESS_CODE.
export function codeMatches(given) {
  const want = env("ACCESS_CODE");
  if (!want || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Every route that spends money or touches your accounts calls this.
// If ACCESS_CODE is set, the request must carry it. Posting routes pass
// { required: true } so they stay off until you set one.
export function checkAccess(request, { required = false } = {}) {
  if (!hasAccessCode()) {
    return required
      ? fail("Posting is off until you set ACCESS_CODE in Vercel.", 403, { code: "no_access_code" })
      : null;
  }
  const given = request.headers.get("x-access-code") || "";
  return codeMatches(given) ? null : fail("Wrong or missing access code.", 401, { code: "bad_access_code" });
}

export function errorMessage(err) {
  if (!err) return "Unknown error";
  return err.message || String(err);
}
