// GET: which social accounts are connected. POST: a link to the connect page.
import { json, fail, readJson, env, checkAccess, errorMessage } from "./_lib.js";
import { ensureProfile, upost, uploadPostUser, PLATFORMS } from "./_upost.js";

function summarise(profile) {
  const accounts = {};
  const social = (profile && profile.social_accounts) || {};
  for (const p of PLATFORMS) {
    const a = social[p];
    accounts[p] = a && typeof a === "object"
      ? { connected: true, name: a.display_name || a.username || a.handle || p }
      : { connected: false };
  }
  return { accounts, reauth: Boolean(profile && profile.reauth_required) };
}

export async function GET(request) {
  const denied = checkAccess(request, { required: true });
  if (denied) return denied;
  if (!env("UPLOADPOST_API_KEY")) return fail("UPLOADPOST_API_KEY is not set in Vercel.", 500);
  try {
    return json(summarise(await ensureProfile()));
  } catch (err) {
    return fail(errorMessage(err), 502);
  }
}

export async function POST(request) {
  const denied = checkAccess(request, { required: true });
  if (denied) return denied;
  if (!env("UPLOADPOST_API_KEY")) return fail("UPLOADPOST_API_KEY is not set in Vercel.", 500);
  const { returnUrl } = await readJson(request);
  try {
    await ensureProfile();
    const r = await upost("/uploadposts/users/generate-jwt", {
      method: "POST",
      json: {
        username: uploadPostUser(),
        redirect_url: typeof returnUrl === "string" ? returnUrl : undefined,
        redirect_button_text: "Back to Clip Cutter",
        connect_title: "Connect your accounts",
        connect_description: "Clip Cutter will post your clips to the accounts you connect here.",
        platforms: PLATFORMS,
        show_calendar: false,
      },
    });
    if (!r.ok || !r.data.access_url) return fail(r.data.message || `Upload-Post said ${r.status}`, 502);
    return json({ url: r.data.access_url });
  } catch (err) {
    return fail(errorMessage(err), 502);
  }
}
