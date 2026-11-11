// Face tracking (for AI reframe) and thumbnails.
// Loads Google's MediaPipe face detector from public CDNs the first time it's needed.

const VISION_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detectorPromise = null;

function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await import(VISION_URL);
      const files = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      const make = (delegate) =>
        vision.FaceDetector.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.5,
        });
      try {
        return await make("GPU");
      } catch {
        return await make("CPU");
      }
    })().catch((err) => {
      console.warn("Face detector unavailable:", err);
      detectorPromise = null;
      return null;
    });
  }
  return detectorPromise;
}

const once = (el, ev) => new Promise((res) => el.addEventListener(ev, res, { once: true }));

async function seek(video, t) {
  const p = once(video, "seeked");
  video.currentTime = t;
  await p;
}

async function loadVideo(url) {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  await once(v, "loadeddata");
  return v;
}

// Samples the clip every `step` seconds and returns a smoothed face track:
// { ok, samples: [{ t, cx, cy, faces: [{cx, cy, w, h}] }] } with coords 0-1.
export async function trackFaces(videoUrl, start, end, { step = 0.5, onProgress, signal } = {}) {
  const detector = await getDetector();
  if (!detector) return { ok: false, samples: [] };
  const video = await loadVideo(videoUrl);
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  // Detect on a downscaled frame: faster and plenty accurate.
  const scale = Math.min(1, 640 / vw);
  const c = document.createElement("canvas");
  c.width = Math.round(vw * scale);
  c.height = Math.round(vh * scale);
  const cx2d = c.getContext("2d", { willReadFrequently: true });

  const raw = [];
  const total = Math.max(1, Math.ceil((end - start) / step));
  for (let i = 0; i <= total; i++) {
    if (signal && signal.aborted) break;
    const t = Math.min(end, start + i * step);
    await seek(video, t);
    cx2d.drawImage(video, 0, 0, c.width, c.height);
    let faces = [];
    try {
      const res = detector.detect(c);
      faces = (res.detections || [])
        .map((d) => {
          const b = d.boundingBox;
          return {
            cx: (b.originX + b.width / 2) / c.width,
            cy: (b.originY + b.height / 2) / c.height,
            w: b.width / c.width,
            h: b.height / c.height,
          };
        })
        // Ignore tiny background faces.
        .filter((f) => f.w > 0.04)
        .sort((a, b) => b.w * b.h - a.w * a.h)
        .slice(0, 2);
    } catch (err) {
      console.warn(err);
    }
    raw.push({ t, faces });
    if (onProgress) onProgress(i / total);
  }
  video.removeAttribute("src");
  video.load();

  // Smooth the camera so it glides instead of jumping between samples.
  const samples = [];
  let sx = 0.5;
  let sy = 0.45;
  let first = true;
  for (const s of raw) {
    const main = s.faces[0];
    if (main) {
      if (first) {
        sx = main.cx;
        sy = main.cy;
        first = false;
      } else if (Math.abs(main.cx - sx) > 0.25) {
        // Big jump (a cut to another person): snap.
        sx = main.cx;
        sy = main.cy;
      } else {
        sx += (main.cx - sx) * 0.35;
        sy += (main.cy - sy) * 0.35;
      }
    }
    samples.push({ t: s.t, cx: sx, cy: sy, faces: s.faces });
  }
  // Steady out flicker in face count: needs 2 samples in a row to switch.
  for (let i = 1; i < samples.length - 1; i++) {
    const a = samples[i - 1].faces.length;
    const b = samples[i + 1].faces.length;
    if (a === b && samples[i].faces.length !== a) {
      samples[i].faces = samples[i - 1].faces;
    }
  }
  return { ok: true, samples };
}

// Small 9:16 thumbnails (JPEG data URLs), one per time in `times`.
export async function thumbnails(videoUrl, times) {
  const video = await loadVideo(videoUrl);
  const c = document.createElement("canvas");
  c.width = 180;
  c.height = 320;
  const ctx = c.getContext("2d");
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(c.width / vw, c.height / vh);
  const sw = c.width / scale;
  const sh = c.height / scale;
  const out = [];
  for (const t of times) {
    await seek(video, Math.min(t, (video.duration || t) - 0.05));
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    out.push(c.toDataURL("image/jpeg", 0.7));
  }
  video.removeAttribute("src");
  video.load();
  return out;
}
