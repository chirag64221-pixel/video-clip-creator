// Lets the browser upload a finished clip straight to your Vercel Blob store.
import { handleUpload } from "@vercel/blob/client";
import { json, fail, codeMatches, hasAccessCode } from "./_lib.js";

export async function POST(request) {
  const body = await request.json();
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // The page sends the access code as the client payload.
        if (!hasAccessCode() || !codeMatches(clientPayload || "")) {
          throw new Error("Wrong or missing access code.");
        }
        return {
          allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime"],
          addRandomSuffix: true,
          maximumSizeInBytes: 500 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {},
    });
    return json(result);
  } catch (err) {
    return fail(err.message, 400);
  }
}
