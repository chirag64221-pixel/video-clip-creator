// Tells the page which features are set up. Never returns key values.
import { json, env, hasAccessCode } from "./_lib.js";

export function GET() {
  const missing = [];
  if (!env("ANTHROPIC_API_KEY")) missing.push("ANTHROPIC_API_KEY");
  if (!env("SUPADATA_API_KEY")) missing.push("SUPADATA_API_KEY");
  const posting = {
    uploadPost: Boolean(env("UPLOADPOST_API_KEY")),
    blob: Boolean(env("BLOB_READ_WRITE_TOKEN")),
    accessCode: hasAccessCode(),
  };
  if (!posting.uploadPost) missing.push("UPLOADPOST_API_KEY");
  if (!posting.blob) missing.push("Blob store (BLOB_READ_WRITE_TOKEN)");
  if (!posting.accessCode) missing.push("ACCESS_CODE");
  return json({
    transcript: Boolean(env("SUPADATA_API_KEY")),
    moments: Boolean(env("ANTHROPIC_API_KEY")),
    posting: posting.uploadPost && posting.blob && posting.accessCode,
    needsCode: hasAccessCode(),
    missing,
  });
}
