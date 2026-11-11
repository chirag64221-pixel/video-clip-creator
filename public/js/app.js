// Clip Cutter: projects, clip grid, editor, posting, brand kit.
import {
  DEFAULT_SETTINGS,
  CAPTION_STYLES,
  Renderer,
  renderClip,
  wordsForRange,
  isFiller,
  pickMime,
} from "./engine.js";
import { trackFaces, thumbnails } from "./faces.js";

// ---------- Small helpers ----------

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};
const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(`cc:${k}`);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`cc:${k}`, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  },
};

// Tiny IndexedDB wrapper for the brand music file.
const idb = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("clip-cutter", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(key, val) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(val, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const r = db.transaction("files").objectStore("files").get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async del(key) {
    const db = await this.open();
    return new Promise((res) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete(key);
      tx.oncomplete = res;
    });
  },
};

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), kind === "bad" ? 9000 : 5000);
}

// ---------- State ----------

const PLATFORMS = [
  ["tiktok", "TikTok"],
  ["instagram", "Instagram Reels"],
  ["youtube", "YouTube Shorts"],
  ["facebook", "Facebook"],
  ["x", "X"],
];

const state = {
  config: null,
  code: store.get("code", ""),
  brand: store.get("brand", { settings: {}, logo: null, musicName: null }),
  post: store.get("post", {
    platforms: { tiktok: true, instagram: true, youtube: true, facebook: false, x: false },
    tiktokPrivacy: "SELF_ONLY",
    youtubePrivacy: "private",
    extra: "",
    autoPost: false,
  }),
  accounts: null,
  projects: store.get("projects", []),
  project: null,
  video: null, // { url, name, duration }
  thumbs: new Map(),
  faces: new Map(),
  outputs: new Map(), // clipId -> { blob, url, mime }
  progress: new Map(), // clipId -> { label, value }
  sort: "score",
  rendering: null, // AbortController
  logoImg: null,
  musicBuffer: undefined,
};

function saveProjects() {
  state.projects = state.projects.slice(0, 8);
  while (!store.set("projects", state.projects) && state.projects.length > 1) {
    state.projects.pop();
  }
}

function saveProject() {
  const p = state.project;
  if (!p) return;
  p.updatedAt = Date.now();
  state.projects = [p, ...state.projects.filter((x) => x.id !== p.id)];
  saveProjects();
}

const brandSettings = () => ({ ...DEFAULT_SETTINGS, ...(state.brand.settings || {}) });
const clipSettings = (clip) => ({ ...brandSettings(), ...(state.project?.settings || {}), ...(clip.settings || {}) });

function loadLogo() {
  state.logoImg = null;
  if (state.brand.logo) {
    const img = new Image();
    img.src = state.brand.logo;
    state.logoImg = img;
  }
}

async function getMusicBuffer() {
  if (state.musicBuffer !== undefined) return state.musicBuffer;
  state.musicBuffer = null;
  try {
    const blob = await idb.get("music");
    if (blob) {
      const ac = new AudioContext();
      state.musicBuffer = await ac.decodeAudioData(await blob.arrayBuffer());
      ac.close();
    }
  } catch (err) {
    console.warn("Music could not be loaded", err);
  }
  return state.musicBuffer;
}

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load("900 40px Montserrat"),
      document.fonts.load("400 40px Anton"),
      document.fonts.load("800 40px Inter"),
      document.fonts.load("700 40px Inter"),
      document.fonts.load("600 40px Inter"),
    ]);
  } catch {}
}

// ---------- API ----------

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: { "content-type": "application/json", "x-access-code": state.code || "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok && res.status !== 202) {
    const err = new Error(data.error || `Something went wrong (${res.status})`);
    err.code = data.code;
    err.status = res.status;
    if (data.code === "bad_access_code") openCode(true);
    throw err;
  }
  return { status: res.status, data };
}

async function loadConfig() {
  const banner = $("#banner");
  try {
    const res = await fetch("/api/config");
    if (!res.ok) throw new Error();
    state.config = await res.json();
  } catch {
    state.config = null;
    banner.innerHTML =
      "<b>The server part isn't running.</b> Clip Cutter needs Vercel (free) to run its <code>api/</code> functions. See the README's “Deploy on Vercel” steps.";
    banner.hidden = false;
    return;
  }
  const c = state.config;
  if (c.missing.length) {
    banner.innerHTML = `<b>Setup needed.</b> In Vercel, add ${c.missing
      .map((m) => `<code>${esc(m)}</code>`)
      .join(", ")}, then redeploy. ${
      c.moments ? "" : "Until Claude is set up you can still add clips by hand."
    }`;
    banner.hidden = false;
  } else banner.hidden = true;
  if (c.needsCode && !state.code) openCode(false);
}

// ---------- Routing ----------

function route() {
  const m = location.hash.match(/^#\/p\/(\w+)/);
  stopPreview();
  if (m) {
    const p = state.projects.find((x) => x.id === m[1]);
    if (p) {
      if (state.project?.id !== p.id) {
        state.video = null;
        state.thumbs.clear();
        state.faces.clear();
        for (const o of state.outputs.values()) URL.revokeObjectURL(o.url);
        state.outputs.clear();
        state.progress.clear();
      }
      state.project = p;
      return renderProject();
    }
  }
  state.project = null;
  renderHome();
}

// ---------- Home ----------

function renderHome() {
  const projects = state.projects;
  $("#app").innerHTML = `
    <section class="hero">
      <h1>Long video in. <span>Viral clips out.</span></h1>
      <p>Paste a link. Clip Cutter finds the best moments, scores them, adds animated captions, reframes to vertical and posts them for you.</p>
    </section>
    <form class="start" id="start-form">
      <div class="url-row">
        <input type="url" id="url" placeholder="Paste a YouTube, TikTok, Instagram, Facebook or X link" autocomplete="off" />
        <button type="submit" id="go">Get clips</button>
      </div>
      <div class="options">
        <div>
          <label for="length">Clip length</label>
          <select id="length">
            <option value="auto">Auto (15–90s)</option>
            <option value="short">Under 30s</option>
            <option value="medium">30–60s</option>
            <option value="long">60–90s</option>
          </select>
        </div>
        <div>
          <label for="count">How many clips</label>
          <select id="count">
            ${[3, 5, 8, 10, 15].map((n) => `<option ${n === 8 ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </div>
        <div>
          <label for="focus">Looking for (optional)</label>
          <input type="text" id="focus" placeholder="e.g. funny, hot takes, advice" />
        </div>
      </div>
      <button type="button" class="linkish" id="toggle-manual">Paste the transcript yourself instead</button>
      <div id="manual" hidden>
        <label for="manual-text">Transcript with times (SRT, or lines like “1:23 text” or “[83.5] text”)</label>
        <textarea id="manual-text" rows="6" placeholder="0:00 Welcome back to the show&#10;0:04 Today we're talking about..."></textarea>
      </div>
    </form>
    ${
      projects.length
        ? `<div class="section-title"><h2>Recent projects</h2><span class="muted small-text">Saved on this device</span></div>
           <div class="projects">${projects
             .map(
               (p) => `<button class="project-card" data-action="open-project" data-id="${p.id}">
                 <b>${esc(p.name)}</b>
                 <span class="muted small-text">${p.clips.length} clips · ${new Date(p.updatedAt || p.createdAt).toLocaleDateString()}</span>
               </button>`,
             )
             .join("")}</div>`
        : ""
    }
    <div class="steps">
      <div class="step"><div class="n">1</div><b>Connect accounts</b><span class="muted small-text">Once. TikTok, Instagram, YouTube, Facebook and X.</span></div>
      <div class="step"><div class="n">2</div><b>Paste a link</b><span class="muted small-text">Claude reads the transcript and picks the best moments.</span></div>
      <div class="step"><div class="n">3</div><b>Add the video file</b><span class="muted small-text">Sites can't hand over video files, so this one step needs it.</span></div>
      <div class="step"><div class="n">4</div><b>Render &amp; post</b><span class="muted small-text">Clips render on your device and post automatically.</span></div>
    </div>`;

  $("#toggle-manual").onclick = () => {
    $("#manual").hidden = !$("#manual").hidden;
  };
  $("#start-form").onsubmit = (e) => {
    e.preventDefault();
    startProject();
  };
}

function parseTranscript(text) {
  const toSec = (s) => {
    const parts = s.replace(",", ".").split(":").map(Number);
    return parts.reduce((t, n) => t * 60 + n, 0);
  };
  const lines = text.replace(/\r/g, "").split("\n");
  const segs = [];
  // SRT / VTT blocks
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d+)/);
    if (m) {
      const start = toSec(m[1]);
      const end = toSec(m[2]);
      const txt = [];
      while (lines[i + 1] && lines[i + 1].trim()) txt.push(lines[++i].trim());
      if (txt.length) segs.push({ text: txt.join(" ").replace(/<[^>]+>/g, ""), start, dur: end - start });
    }
  }
  if (segs.length) return segs;
  for (const raw of lines) {
    const l = raw.trim();
    let m = l.match(/^\[?(\d+(?:\.\d+)?)\]\s*(.+)$/);
    if (m) {
      segs.push({ text: m[2], start: Number(m[1]), dur: 0 });
      continue;
    }
    m = l.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–:]?\s*(.+)$/);
    if (m) segs.push({ text: m[2], start: toSec(m[1]), dur: 0 });
  }
  for (let i = 0; i < segs.length; i++) {
    if (!segs[i].dur) segs[i].dur = segs[i + 1] ? Math.max(0.5, segs[i + 1].start - segs[i].start) : 3;
  }
  return segs;
}

function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop() || "";
    return `${u.hostname.replace(/^www\./, "")} · ${id}`.slice(0, 80);
  } catch {
    return "My video";
  }
}

async function startProject() {
  const url = $("#url").value.trim();
  const manual = !$("#manual").hidden && $("#manual-text").value.trim();
  const length = $("#length").value;
  const count = Number($("#count").value);
  const focus = $("#focus").value.trim();
  if (!url && !manual) return toast("Paste a video link first.", "bad");
  const app = $("#app");
  const showStep = (msg) => {
    app.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(msg)}</div></div>`;
  };

  let segments;
  try {
    if (manual) {
      segments = parseTranscript(manual);
      if (!segments.length) throw new Error("No times found in the transcript. Use SRT or “1:23 text” lines.");
    } else {
      showStep("Getting the transcript…");
      let r = await api("transcript", { method: "POST", body: { url } });
      const until = Date.now() + 5 * 60_000;
      while (r.status === 202 && Date.now() < until) {
        showStep("Making a transcript (this video has no captions). This can take a few minutes…");
        await sleep(4000);
        r = await api(`transcript?jobId=${encodeURIComponent(r.data.jobId)}`);
      }
      if (r.status === 202) throw new Error("The transcript is taking too long. Try again in a few minutes.");
      segments = r.data.segments;
    }
  } catch (err) {
    renderHome();
    $("#url").value = url;
    return toast(err.message, "bad");
  }

  const project = {
    id: uid(),
    url,
    name: url ? nameFromUrl(url) : "Pasted transcript",
    createdAt: Date.now(),
    segments,
    clips: [],
    settings: {},
  };

  if (state.config?.moments) {
    showStep("Claude is watching for the best moments…");
    try {
      const r = await api("moments", { method: "POST", body: { segments, length, count, focus } });
      project.clips = r.data.clips;
      if (!project.clips.length) toast("Claude didn't find strong moments. Add clips by hand or try another focus.");
    } catch (err) {
      toast(`Couldn't find moments: ${err.message}`, "bad");
    }
  } else {
    toast("Claude isn't set up, so add clips by hand with “Add clip”.");
  }

  state.project = project;
  saveProject();
  location.hash = `#/p/${project.id}`;
}

// ---------- Project ----------

function sortedClips() {
  const clips = [...state.project.clips];
  return state.sort === "score" ? clips.sort((a, b) => b.score - a.score) : clips.sort((a, b) => a.start - b.start);
}

function scoreClass(s) {
  return s >= 80 ? "hi" : s >= 60 ? "mid" : "lo";
}

function clipCard(c) {
  const out = state.outputs.get(c.id);
  const prog = state.progress.get(c.id);
  const thumb = state.thumbs.get(c.id);
  const pill = c.postState === "posted"
    ? `<span class="status-pill posted">Posted</span>`
    : c.postState === "posting"
      ? `<span class="status-pill">Posting…</span>`
      : c.postState === "error"
        ? `<span class="status-pill error">Post failed</span>`
        : out
          ? `<span class="status-pill done">Rendered</span>`
          : "";
  return `
  <article class="clip" data-id="${c.id}">
    <div class="thumb" ${out ? "" : `data-action="edit" data-id="${c.id}"`} style="${thumb ? `background-image:url(${thumb})` : ""}">
      ${out ? `<video src="${out.url}" controls playsinline preload="metadata"></video>` : c.hook ? `<div class="hook-preview">${esc(c.hook)}</div>` : ""}
      <div class="score ${scoreClass(c.score)}">${c.score}<small>/99</small></div>
      ${pill}
      ${out ? "" : `<div class="dur">${fmt(c.end - c.start)}</div>`}
    </div>
    ${prog ? `<div class="muted small-text" style="padding:8px 12px 4px">${esc(prog.label)}</div><div class="progress"><i style="width:${Math.round(prog.value * 100)}%"></i></div>` : ""}
    <div class="body">
      <div class="title">${esc(c.title)}</div>
      <div class="muted small-text">${fmt(c.start)} – ${fmt(c.end)}</div>
      ${c.reason ? `<div class="reason">${esc(c.reason)}</div>` : ""}
      ${
        c.scores
          ? `<div class="subscores">
              <div><b>${c.scores.hook}</b>Hook</div><div><b>${c.scores.flow}</b>Flow</div>
              <div><b>${c.scores.value}</b>Value</div><div><b>${c.scores.shareability}</b>Share</div>
            </div>`
          : ""
      }
    </div>
    <div class="actions">
      <button class="small ghost" data-action="edit" data-id="${c.id}">Edit</button>
      <button class="small ${out ? "ghost" : ""}" data-action="render" data-id="${c.id}" ${state.rendering ? "disabled" : ""}>${out ? "Re-render" : "Render"}</button>
      ${out ? `<button class="small ghost" data-action="download" data-id="${c.id}">Download</button>` : ""}
      ${out ? `<button class="small" data-action="post" data-id="${c.id}">Post now</button>` : ""}
    </div>
  </article>`;
}

function renderProject() {
  const p = state.project;
  const v = state.video;
  const mime = pickMime();
  $("#app").innerHTML = `
    <div class="project-head">
      <div>
        <h1>${esc(p.name)}</h1>
        <div class="muted small-text">${p.clips.length} clips${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">source</a>` : ""}</div>
      </div>
      <div class="toolbar">
        <div class="seg">
          <button class="${state.sort === "score" ? "on" : ""}" data-action="sort" data-sort="score">By score</button>
          <button class="${state.sort === "time" ? "on" : ""}" data-action="sort" data-sort="time">By timeline</button>
        </div>
        <button class="ghost small" data-action="add-clip">Add clip</button>
        <button class="ghost small" data-action="export-json">Export list</button>
        <button class="ghost small" data-action="delete-project">Delete</button>
      </div>
    </div>

    <label class="dropzone ${v ? "ready" : ""}" id="drop">
      <div>
        <b>${v ? `Video: ${esc(v.name)}` : "Add the video file"}</b>
        <div class="muted small-text">${
          v
            ? "Ready to render. Rendering happens on this device."
            : p.videoName
              ? `Re-add <b>${esc(p.videoName)}</b> to keep editing. Websites can't pull video files out of YouTube or TikTok.`
              : "Websites can't pull video files out of YouTube or TikTok, so drop the file here. Clipping campaigns usually share it."
        }</div>
      </div>
      <span class="ghost" style="border:1px solid var(--line);border-radius:10px;padding:9px 14px;font-weight:600">${v ? "Change file" : "Choose file"}</span>
      <input type="file" accept="video/*" id="file" hidden />
    </label>

    <div class="render-bar">
      ${
        state.rendering
          ? `<button class="danger" data-action="stop-render">Stop rendering</button>`
          : `<button data-action="render-all" ${v && p.clips.length ? "" : "disabled"}>Render all clips</button>`
      }
      <label class="check" style="margin:0"><input type="checkbox" id="autopost" ${state.post.autoPost ? "checked" : ""} /> Post each clip as soon as it finishes rendering</label>
      <span class="muted small-text" style="margin-left:auto">${
        mime ? `Exports ${mime.startsWith("video/mp4") ? "MP4" : "WebM (use Chrome or Edge for MP4)"}` : "This browser can't export video. Use Chrome or Edge."
      } · keep this tab open while rendering</span>
    </div>

    <div class="section-title"><h2>Clips</h2></div>
    ${p.clips.length ? `<div class="grid">${sortedClips().map(clipCard).join("")}</div>` : `<div class="empty">No clips yet. Use “Add clip” to pick a moment by hand.</div>`}
  `;

  const drop = $("#drop");
  $("#file").onchange = (e) => e.target.files[0] && setVideo(e.target.files[0]);
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  };
  drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("video/")) setVideo(f);
  };
  $("#autopost").onchange = (e) => {
    state.post.autoPost = e.target.checked;
    store.set("post", state.post);
    if (e.target.checked && !state.config?.posting) toast("Posting isn't set up yet. See the banner at the top.", "bad");
  };
}

function refreshCard(id) {
  const el = $(`.clip[data-id="${id}"]`);
  const clip = state.project?.clips.find((c) => c.id === id);
  if (!el || !clip) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = clipCard(clip);
  el.replaceWith(tmp.firstElementChild);
}

async function setVideo(file) {
  const v = document.createElement("video");
  const url = URL.createObjectURL(file);
  v.preload = "metadata";
  v.src = url;
  try {
    await new Promise((res, rej) => {
      v.onloadedmetadata = res;
      v.onerror = () => rej(new Error("This browser can't open that video file."));
    });
  } catch (err) {
    URL.revokeObjectURL(url);
    return toast(err.message, "bad");
  }
  if (state.video) URL.revokeObjectURL(state.video.url);
  state.video = { url, name: file.name, duration: v.duration };
  state.faces.clear();
  state.project.videoName = file.name;
  saveProject();
  const last = state.project.segments.at(-1);
  if (last && v.duration && Math.abs(v.duration - (last.start + last.dur)) > 30) {
    toast("Heads up: this file's length doesn't match the transcript. Make sure it's the same video.", "bad");
  }
  renderProject();
  makeThumbs();
}

async function makeThumbs() {
  if (!state.video) return;
  const clips = state.project.clips.filter((c) => !state.thumbs.has(c.id));
  if (!clips.length) return;
  try {
    const imgs = await thumbnails(state.video.url, clips.map((c) => Math.min(c.start + 1, c.end)));
    clips.forEach((c, i) => state.thumbs.set(c.id, imgs[i]));
    clips.forEach((c) => refreshCard(c.id));
  } catch (err) {
    console.warn(err);
  }
}

// ---------- Rendering ----------

async function facesFor(clip, onProgress, signal) {
  const st = clipSettings(clip);
  if (!["auto", "face", "split"].includes(st.reframe) || st.shape === "16:9") return null;
  const key = `${clip.id}:${clip.start}:${clip.end}`;
  if (state.faces.has(key)) return state.faces.get(key);
  const track = await trackFaces(state.video.url, clip.start, clip.end, { onProgress, signal });
  if (!track.ok) toast("Face tracking couldn't load, so clips use a centred layout.", "bad");
  state.faces.set(key, track);
  return track;
}

async function renderOne(clip, signal) {
  if (!state.video) throw new Error("Add the video file first.");
  const setProg = (label, value) => {
    state.progress.set(clip.id, { label, value });
    const el = $(`.clip[data-id="${clip.id}"] .progress i`);
    if (el) el.style.width = `${Math.round(value * 100)}%`;
    else refreshCard(clip.id);
  };
  try {
    await fontsReady();
    setProg("Tracking faces…", 0);
    refreshCard(clip.id);
    const faces = await facesFor(clip, (v) => setProg("Tracking faces…", v), signal);
    setProg("Rendering…", 0);
    refreshCard(clip.id);
    const res = await renderClip({
      videoUrl: state.video.url,
      clip,
      segments: state.project.segments,
      settings: clipSettings(clip),
      faces,
      logo: state.logoImg,
      musicBuffer: await getMusicBuffer(),
      onProgress: (v) => setProg("Rendering…", v),
      signal,
    });
    const old = state.outputs.get(clip.id);
    if (old) URL.revokeObjectURL(old.url);
    state.outputs.set(clip.id, { ...res, url: URL.createObjectURL(res.blob) });
    clip.postState = null;
    state.progress.delete(clip.id);
    refreshCard(clip.id);
    return true;
  } catch (err) {
    state.progress.delete(clip.id);
    refreshCard(clip.id);
    if (err.name === "AbortError") return false;
    toast(`Render failed: ${err.message}`, "bad");
    return false;
  }
}

async function runRenders(clips) {
  if (state.rendering) return;
  if (!state.video) return toast("Add the video file first.", "bad");
  const ctrl = new AbortController();
  state.rendering = ctrl;
  renderProject();
  try {
    for (const clip of clips) {
      if (ctrl.signal.aborted) break;
      const ok = await renderOne(clip, ctrl.signal);
      if (ok && state.post.autoPost && state.config?.posting) {
        // Post in the background while the next clip renders.
        postClip(clip, defaultPostFields(clip)).catch(() => {});
      }
    }
  } finally {
    state.rendering = null;
    if (state.project) renderProject();
  }
}

// ---------- Posting ----------

function defaultPostFields(clip) {
  const tags = (clip.hashtags || []).map((h) => `#${h}`).join(" ");
  const caption = [clip.caption, tags, state.post.extra].filter(Boolean).join("\n\n");
  const connected = state.accounts?.accounts || {};
  const platforms = PLATFORMS.map(([p]) => p).filter(
    (p) => state.post.platforms[p] && (!state.accounts || connected[p]?.connected),
  );
  return {
    title: clip.hook || clip.title,
    caption,
    platforms,
    tiktokPrivacy: state.post.tiktokPrivacy,
    youtubePrivacy: state.post.youtubePrivacy,
    scheduleAt: null,
  };
}

async function postClip(clip, fields) {
  const out = state.outputs.get(clip.id);
  if (!out) throw new Error("Render the clip first.");
  if (!fields.platforms.length) {
    toast("No accounts picked. Open Accounts to connect or switch them on.", "bad");
    throw new Error("no platforms");
  }
  clip.postState = "posting";
  refreshCard(clip.id);
  try {
    const { upload } = await import("/vendor/blob-client.js");
    const ext = out.mime === "video/mp4" ? "mp4" : "webm";
    const slug = (clip.title || "clip").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "clip";
    const blob = await upload(`clips/${slug}.${ext}`, out.blob, {
      access: "public",
      handleUploadUrl: "/api/blob-upload",
      clientPayload: state.code,
      contentType: out.mime,
      multipart: out.blob.size > 20 * 1024 * 1024,
    });
    const r = await api("post", { method: "POST", body: { ...fields, videoUrl: blob.url } });
    if (r.data.scheduled) {
      clip.postState = "posted";
      toast(`Scheduled “${clip.title}”.`, "good");
    } else {
      toast(`Posting “${clip.title}”…`);
      const results = await waitForPosts(r.data.sent, blob.url);
      const failed = results.filter((x) => !x.success);
      clip.postState = failed.length === results.length && results.length ? "error" : "posted";
      for (const f of failed) toast(`${f.platform}: ${f.message || "failed"}`, "bad");
      if (results.length && failed.length < results.length) {
        toast(`Posted “${clip.title}” to ${results.filter((x) => x.success).map((x) => x.platform).join(", ")}.`, "good");
      }
    }
    clip.postedAt = Date.now();
    saveProject();
  } catch (err) {
    clip.postState = "error";
    if (err.message !== "no platforms") toast(`Post failed: ${err.message}`, "bad");
    throw err;
  } finally {
    refreshCard(clip.id);
  }
}

async function waitForPosts(sent, blobUrl) {
  const ids = sent.map((s) => s.requestId).filter(Boolean);
  const direct = sent.flatMap((s) =>
    s.results && typeof s.results === "object"
      ? Object.entries(s.results).map(([platform, v]) => ({ platform, success: Boolean(v && v.success), message: v?.error || v?.message || "" }))
      : [],
  );
  if (!ids.length) return direct;
  const done = new Map();
  const until = Date.now() + 15 * 60_000;
  while (done.size < ids.length && Date.now() < until) {
    await sleep(5000);
    for (const id of ids) {
      if (done.has(id)) continue;
      try {
        const last = done.size === ids.length - 1;
        const q = new URLSearchParams({ requestId: id });
        const r = await api(`post-status?${q}`);
        if (r.data.done) {
          done.set(id, r.data.results);
          // Delete the stored clip only once every request has finished.
          if (last) await api(`post-status?${new URLSearchParams({ requestId: id, blobUrl })}`).catch(() => {});
        }
      } catch {}
    }
  }
  return [...done.values()].flat();
}

function openPost(clip) {
  const f = defaultPostFields(clip);
  const acc = state.accounts?.accounts;
  openModal(`
    <h2>Post clip</h2>
    <p class="muted small-text">${esc(clip.title)}</p>
    <label for="p-caption">Caption</label>
    <textarea id="p-caption" rows="5">${esc(f.caption)}</textarea>
    <label for="p-title">YouTube title</label>
    <input type="text" id="p-title" value="${esc(f.title)}" maxlength="100" />
    <label>Post to</label>
    ${PLATFORMS.map(([p, name]) => {
      const connected = !acc || acc[p]?.connected;
      return `<label class="check"><input type="checkbox" name="plat" value="${p}" ${f.platforms.includes(p) ? "checked" : ""} ${connected ? "" : "disabled"} /> ${name}${
        acc && !connected ? ' <span class="muted small-text">(not connected)</span>' : ""
      }</label>`;
    }).join("")}
    <div class="row">
      <div><label for="p-tt">TikTok privacy</label>${privacySelect("p-tt", "tiktok", f.tiktokPrivacy)}</div>
      <div><label for="p-yt">YouTube privacy</label>${privacySelect("p-yt", "youtube", f.youtubePrivacy)}</div>
    </div>
    <label for="p-when">Schedule (leave empty to post now)</label>
    <input type="datetime-local" id="p-when" />
    <div class="row" style="margin-top:18px">
      <button id="p-go">Post</button>
    </div>
  `);
  $("#p-go").onclick = () => {
    const when = $("#p-when").value;
    const fields = {
      caption: $("#p-caption").value,
      title: $("#p-title").value,
      platforms: $$('input[name="plat"]:checked').map((i) => i.value),
      tiktokPrivacy: $("#p-tt").value,
      youtubePrivacy: $("#p-yt").value,
      scheduleAt: when ? new Date(when).toISOString() : null,
    };
    closeModal();
    postClip(clip, fields).catch(() => {});
  };
}

function privacySelect(id, platform, value) {
  const opts =
    platform === "tiktok"
      ? [
          ["SELF_ONLY", "Only me (test)"],
          ["MUTUAL_FOLLOW_FRIENDS", "Friends"],
          ["FOLLOWER_OF_CREATOR", "Followers"],
          ["PUBLIC_TO_EVERYONE", "Everyone"],
        ]
      : [
          ["private", "Private (test)"],
          ["unlisted", "Unlisted"],
          ["public", "Public"],
        ];
  return `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${l}</option>`).join("")}</select>`;
}

// ---------- Modals ----------

function openModal(html, wide = false) {
  $("#modal-body").innerHTML = html;
  $(".modal-card").classList.toggle("wide", wide);
  $("#modal").hidden = false;
}

function closeModal() {
  stopPreview();
  $("#modal").hidden = true;
  $("#modal-body").innerHTML = "";
}

function openCode(wrong) {
  openModal(`
    <h2>Access code</h2>
    <p class="muted small-text">${wrong ? "That code didn't work. " : ""}Enter the <code>ACCESS_CODE</code> you set in Vercel. It's saved on this device only.</p>
    <input type="password" id="code" value="${esc(state.code)}" autocomplete="current-password" />
    <div class="row" style="margin-top:14px"><button id="code-save">Save</button></div>
  `);
  $("#code-save").onclick = () => {
    state.code = $("#code").value.trim();
    store.set("code", state.code);
    closeModal();
    toast("Access code saved.", "good");
    state.accounts = null;
  };
}

async function openAccounts() {
  openModal(`<h2>Accounts</h2><div class="loading"><div class="spinner"></div></div>`);
  if (!state.config?.posting) {
    return openModal(`
      <h2>Accounts</h2>
      <p class="muted">Posting isn't set up yet. In Vercel add ${
        (state.config?.missing || ["UPLOADPOST_API_KEY", "ACCESS_CODE", "a Blob store"])
          .filter((m) => !/ANTHROPIC|SUPADATA/.test(m))
          .map((m) => `<code>${esc(m)}</code>`)
          .join(", ") || "the posting keys"
      }, then redeploy. See the README.</p>`);
  }
  try {
    const r = await api("accounts");
    state.accounts = r.data;
  } catch (err) {
    return openModal(`<h2>Accounts</h2><p class="muted">${esc(err.message)}</p>`);
  }
  const acc = state.accounts.accounts;
  openModal(`
    <h2>Accounts</h2>
    <p class="muted small-text">Switch on the accounts clips should go to.${state.accounts.reauth ? " <b>One account needs reconnecting.</b>" : ""}</p>
    ${PLATFORMS.map(
      ([p, name]) => `<div class="acct">
        <div><span class="dot ${acc[p]?.connected ? "on" : ""}"></span>${name}
          <div class="muted small-text">${acc[p]?.connected ? esc(acc[p].name) : "not connected"}</div></div>
        <label class="check"><input type="checkbox" data-plat="${p}" ${state.post.platforms[p] ? "checked" : ""} ${acc[p]?.connected ? "" : "disabled"} /> Post here</label>
      </div>`,
    ).join("")}
    <div class="row" style="margin-top:8px">
      <button id="connect">Connect accounts</button>
      <button class="ghost" id="refresh-acc">Refresh</button>
    </div>
    <h3 style="margin:22px 0 0">Posting defaults</h3>
    <div class="row">
      <div><label for="d-tt">TikTok privacy</label>${privacySelect("d-tt", "tiktok", state.post.tiktokPrivacy)}</div>
      <div><label for="d-yt">YouTube privacy</label>${privacySelect("d-yt", "youtube", state.post.youtubePrivacy)}</div>
    </div>
    <label for="d-extra">Add to every caption (campaign tags, links…)</label>
    <textarea id="d-extra" rows="3">${esc(state.post.extra)}</textarea>
    <p class="muted small-text">Instagram needs a Business or Creator account linked to a Facebook Page. Test with private posts first.</p>
    <div class="row"><button id="d-save">Save</button></div>
  `);
  $("#connect").onclick = async () => {
    try {
      const r = await api("accounts", { method: "POST", body: { returnUrl: location.href } });
      location.href = r.data.url;
    } catch (err) {
      toast(err.message, "bad");
    }
  };
  $("#refresh-acc").onclick = () => openAccounts();
  $("#d-save").onclick = () => {
    $$("input[data-plat]").forEach((i) => (state.post.platforms[i.dataset.plat] = i.checked));
    state.post.tiktokPrivacy = $("#d-tt").value;
    state.post.youtubePrivacy = $("#d-yt").value;
    state.post.extra = $("#d-extra").value;
    store.set("post", state.post);
    closeModal();
    toast("Saved.", "good");
  };
}

function settingsFields(st, prefix) {
  return `
    <label>Caption style</label>
    <div class="style-grid">${Object.entries(CAPTION_STYLES)
      .map(
        ([k, s]) => `<button type="button" class="${st.capStyle === k ? "on" : ""}" data-set="capStyle" data-val="${k}">
          <span class="sample" style="font:${s.font.replace("{s}", 15)}, sans-serif">${s.upper ? s.label.toUpperCase() : s.label}</span></button>`,
      )
      .join("")}</div>
    <div class="row">
      <div><label>Highlight</label><input type="color" data-set="capColor" value="${st.capColor}" /></div>
      <div><label>Key words</label><input type="color" data-set="keyColor" value="${st.keyColor}" /></div>
    </div>
    <label>Caption size</label><input type="range" min="0.6" max="1.6" step="0.05" data-set="capSize" value="${st.capSize}" />
    <label>Caption position</label><input type="range" min="0.15" max="0.88" step="0.01" data-set="capPos" value="${st.capPos}" />
    <label class="check"><input type="checkbox" data-set="captions" ${st.captions ? "checked" : ""} /> Show captions</label>
    <label class="check"><input type="checkbox" data-set="keywords" ${st.keywords ? "checked" : ""} /> Colour key words</label>
    <label class="check"><input type="checkbox" data-set="emojis" ${st.emojis ? "checked" : ""} /> Pop emojis on key words</label>
    <label>Layout</label>
    <div class="seg">${[
      ["auto", "Auto"],
      ["face", "Follow face"],
      ["split", "Split screen"],
      ["center", "Centre"],
      ["fit", "Fit + blur"],
    ]
      .map(([v, l]) => `<button type="button" class="${st.reframe === v ? "on" : ""}" data-set="reframe" data-val="${v}">${l}</button>`)
      .join("")}</div>
    <label>Shape</label>
    <div class="seg">${["9:16", "4:5", "1:1", "16:9"]
      .map((v) => `<button type="button" class="${st.shape === v ? "on" : ""}" data-set="shape" data-val="${v}">${v}</button>`)
      .join("")}</div>
    <label>Quality</label>
    <div class="seg">${[720, 1080]
      .map((v) => `<button type="button" class="${Number(st.quality) === v ? "on" : ""}" data-set="quality" data-val="${v}">${v}p</button>`)
      .join("")}</div>
    <label>Auto editor</label>
    <label class="check"><input type="checkbox" data-set="removePauses" ${st.removePauses ? "checked" : ""} /> Remove pauses</label>
    <label class="check"><input type="checkbox" data-set="removeFillers" ${st.removeFillers ? "checked" : ""} /> Cut “um” and “uh” (beta)</label>
    <label class="check"><input type="checkbox" data-set="zooms" ${st.zooms ? "checked" : ""} /> Punch-in zooms</label>
    <label class="check"><input type="checkbox" data-set="hookTitle" ${st.hookTitle ? "checked" : ""} /> Hook title</label>
    <label class="check"><input type="checkbox" data-set="progressBar" ${st.progressBar ? "checked" : ""} /> Progress bar</label>
    <label class="check"><input type="checkbox" data-set="logo" ${st.logo ? "checked" : ""} /> Logo (from brand kit)</label>
    <label class="check"><input type="checkbox" data-set="music" ${st.music ? "checked" : ""} /> Background music (from brand kit)</label>
    <label>Music volume</label><input type="range" min="0" max="0.6" step="0.01" data-set="musicVol" value="${st.musicVol}" />
  `.replace(/data-set=/g, `data-${prefix}set=`);
}

// Wires up inputs made by settingsFields(); calls onChange(key, value).
function bindSettings(root, prefix, onChange) {
  const attr = `data-${prefix}set`;
  root.addEventListener("click", (e) => {
    const b = e.target.closest(`button[${attr}]`);
    if (!b) return;
    const key = b.getAttribute(attr);
    let val = b.dataset.val;
    if (key === "quality") val = Number(val);
    $$(`button[${attr}="${key}"]`, root).forEach((x) => x.classList.toggle("on", x === b));
    onChange(key, val);
  });
  root.addEventListener("input", (e) => {
    const i = e.target;
    const key = i.getAttribute(attr);
    if (!key) return;
    const val = i.type === "checkbox" ? i.checked : i.type === "range" ? Number(i.value) : i.value;
    onChange(key, val);
  });
}

async function openBrand() {
  const st = brandSettings();
  openModal(
    `
    <h2>Brand kit</h2>
    <p class="muted small-text">Saved on this device and used for every new clip.</p>
    <label>Logo</label>
    <div class="row">
      ${state.brand.logo ? `<img class="logo-preview" src="${state.brand.logo}" alt="Logo" />` : ""}
      <input type="file" accept="image/*" id="b-logo" />
      ${state.brand.logo ? `<button class="ghost small" id="b-logo-x" style="flex:0">Remove</button>` : ""}
    </div>
    <label>Background music (dips under speech)</label>
    <div class="row">
      <span class="muted small-text">${state.brand.musicName ? esc(state.brand.musicName) : "None"}</span>
      <input type="file" accept="audio/*" id="b-music" />
      ${state.brand.musicName ? `<button class="ghost small" id="b-music-x" style="flex:0">Remove</button>` : ""}
    </div>
    <div id="b-settings">${settingsFields(st, "b")}</div>
    <div class="row" style="margin-top:18px">
      <button id="b-save">Save brand kit</button>
      ${state.project ? `<button class="ghost" id="b-apply">Save &amp; apply to this project's clips</button>` : ""}
    </div>
  `,
    false,
  );
  const draft = { ...st };
  bindSettings($("#b-settings"), "b", (k, v) => (draft[k] = v));
  $("#b-logo").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    state.brand.logo = await shrinkImage(f, 400);
    store.set("brand", state.brand);
    loadLogo();
    openBrand();
  };
  if ($("#b-logo-x"))
    $("#b-logo-x").onclick = () => {
      state.brand.logo = null;
      store.set("brand", state.brand);
      loadLogo();
      openBrand();
    };
  $("#b-music").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      await idb.put("music", f);
      state.brand.musicName = f.name;
      state.musicBuffer = undefined;
      store.set("brand", state.brand);
      openBrand();
    } catch {
      toast("Couldn't save the music file on this device.", "bad");
    }
  };
  if ($("#b-music-x"))
    $("#b-music-x").onclick = async () => {
      await idb.del("music");
      state.brand.musicName = null;
      state.musicBuffer = undefined;
      store.set("brand", state.brand);
      openBrand();
    };
  const save = () => {
    state.brand.settings = draft;
    store.set("brand", state.brand);
  };
  $("#b-save").onclick = () => {
    save();
    closeModal();
    toast("Brand kit saved.", "good");
  };
  if ($("#b-apply"))
    $("#b-apply").onclick = () => {
      save();
      state.project.settings = {};
      state.project.clips.forEach((c) => (c.settings = null));
      saveProject();
      closeModal();
      toast("Applied to every clip. Re-render to see it.", "good");
    };
}

function shrinkImage(file, max) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL("image/png"));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Editor ----------

let preview = null;

function stopPreview() {
  if (!preview) return;
  preview.stopped = true;
  preview.video.pause();
  if (preview.music) preview.music.pause();
  preview.video.removeAttribute("src");
  preview.video.load();
  preview = null;
}

function openEditor(clip) {
  const draft = JSON.parse(JSON.stringify(clip));
  draft.cuts = draft.cuts || [];
  let st = clipSettings(draft);
  let wordMode = "cut";
  const total = state.project.segments.reduce((m, s) => Math.max(m, s.start + s.dur), 0);
  const maxT = state.video?.duration || total;

  openModal(
    `
    <h2>Edit clip</h2>
    <div class="editor">
      <div class="stage">
        <canvas id="e-canvas"></canvas>
        <div class="controls">
          <button class="small" id="e-play" ${state.video ? "" : "disabled"}>Play</button>
          <button class="small ghost" id="e-restart" ${state.video ? "" : "disabled"}>Restart</button>
          <span class="time" id="e-time">0:00 / 0:00</span>
        </div>
        ${state.video ? "" : `<p class="muted small-text">Add the video file on the project page to see the picture.</p>`}
        <p class="muted small-text" id="e-faces"></p>
        <div class="trim">
          <div><label>Start</label><input type="number" step="0.1" id="e-start" value="${draft.start.toFixed(1)}" />
            <div class="nudge"><button class="small ghost" data-nudge="start" data-d="-1">−1s</button><button class="small ghost" data-nudge="start" data-d="-0.2">−.2</button><button class="small ghost" data-nudge="start" data-d="0.2">+.2</button><button class="small ghost" data-nudge="start" data-d="1">+1s</button></div></div>
          <div><label>End</label><input type="number" step="0.1" id="e-end" value="${draft.end.toFixed(1)}" />
            <div class="nudge"><button class="small ghost" data-nudge="end" data-d="-1">−1s</button><button class="small ghost" data-nudge="end" data-d="-0.2">−.2</button><button class="small ghost" data-nudge="end" data-d="0.2">+.2</button><button class="small ghost" data-nudge="end" data-d="1">+1s</button></div></div>
        </div>
      </div>
      <div>
        <div class="tabs">
          <button class="on" data-tab="text">Text</button>
          <button data-tab="style">Style &amp; layout</button>
          <button data-tab="words">Transcript</button>
        </div>
        <div data-pane="text">
          <label for="e-title">Name</label><input type="text" id="e-title" value="${esc(draft.title)}" />
          <label for="e-hook">Hook title (first 3 seconds)</label><input type="text" id="e-hook" value="${esc(draft.hook)}" />
          <label for="e-caption">Post caption</label><textarea id="e-caption" rows="3">${esc(draft.caption)}</textarea>
          <label for="e-tags">Hashtags</label><input type="text" id="e-tags" value="${esc((draft.hashtags || []).join(" "))}" />
          <label for="e-score">Score</label><input type="number" min="0" max="99" id="e-score" value="${draft.score}" />
        </div>
        <div data-pane="style" hidden id="e-settings">${settingsFields(st, "e")}</div>
        <div data-pane="words" hidden>
          <div class="row" style="margin-bottom:10px">
            <span class="muted small-text" style="flex:2">Click words to</span>
            <div class="seg" style="flex:3"><button class="on" data-wmode="cut">Cut them</button><button data-wmode="key">Make key words</button></div>
          </div>
          <div class="transcript" id="e-words"></div>
          <p class="muted small-text">Struck-through words are cut. Orange words are fillers. Green words are key words.</p>
        </div>
        <div class="row" style="margin-top:18px">
          <button id="e-save">Save</button>
          <button class="ghost" id="e-save-all">Save &amp; use this style on all clips</button>
          <button class="ghost danger" id="e-delete" style="flex:0">Delete clip</button>
        </div>
      </div>
    </div>`,
    true,
  );

  const canvas = $("#e-canvas");
  const renderer = new Renderer({
    canvas,
    clip: draft,
    segments: state.project.segments,
    settings: st,
    faces: null,
    logo: state.logoImg,
  });

  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  preview = { video, stopped: false, music: null };
  let rangeIdx = 0;

  const outNow = () => {
    const r = renderer.ranges[rangeIdx];
    return r ? r.off + Math.max(0, video.currentTime - r.s) : 0;
  };
  const drawNow = () => {
    const src = state.video ? video.currentTime : draft.start;
    renderer.draw(state.video ? video : null, src, outNow());
    $("#e-time").textContent = `${fmt(outNow())} / ${fmt(renderer.duration)}`;
    const cur = $("#e-words span.now");
    if (cur) cur.classList.remove("now");
    const w = renderer.words.find((x) => src >= x.s && src < x.e);
    if (w) $(`#e-words span[data-k="${w.key}"]`)?.classList.add("now");
  };

  const seekTo = (t) =>
    new Promise((res) => {
      if (!state.video) return res();
      video.addEventListener("seeked", res, { once: true });
      video.currentTime = t;
    });

  const restart = async () => {
    rangeIdx = 0;
    if (renderer.ranges[0]) await seekTo(renderer.ranges[0].s);
    drawNow();
  };

  const loop = async () => {
    if (!preview || preview.stopped) return;
    if (!video.paused) {
      const r = renderer.ranges[rangeIdx];
      if (r && video.currentTime >= r.e) {
        if (rangeIdx + 1 < renderer.ranges.length) {
          rangeIdx++;
          video.pause();
          await seekTo(renderer.ranges[rangeIdx].s);
          if (preview && !preview.stopped) video.play();
        } else {
          video.pause();
          if (preview.music) preview.music.pause();
          $("#e-play").textContent = "Play";
          await restart();
        }
      }
      drawNow();
    }
    requestAnimationFrame(loop);
  };

  const refresh = async () => {
    renderer.update(draft, state.project.segments, st);
    if (rangeIdx >= renderer.ranges.length) rangeIdx = 0;
    drawWords();
    drawNow();
  };

  const loadFaces = async () => {
    if (!state.video) return;
    const need = ["auto", "face", "split"].includes(st.reframe) && st.shape !== "16:9";
    if (!need) return;
    $("#e-faces").textContent = "Tracking faces…";
    const track = await facesFor({ ...draft, settings: st }, (v) => {
      $("#e-faces") && ($("#e-faces").textContent = `Tracking faces… ${Math.round(v * 100)}%`);
    });
    if (!preview || preview.stopped) return;
    renderer.faces = track;
    $("#e-faces").textContent = track && track.ok ? "" : "Face tracking unavailable: using a centred layout.";
    drawNow();
  };

  const drawWords = () => {
    const box = $("#e-words");
    if (!box) return;
    const keys = new Set((draft.keywords || []).map((k) => k.word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "")));
    const cuts = new Set(draft.cuts);
    box.innerHTML = renderer.words
      .map((w) => {
        const n = w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
        const cls = [cuts.has(w.key) ? "cut" : "", isFiller(w.text) ? "filler" : "", keys.has(n) ? "key" : ""].join(" ");
        return `<span data-k="${w.key}" class="${cls}">${esc(w.text)}</span>`;
      })
      .join(" ");
  };

  // Tabs
  $$(".tabs button").forEach((b) => {
    b.onclick = () => {
      $$(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $$("[data-pane]").forEach((p) => (p.hidden = p.dataset.pane !== b.dataset.tab));
    };
  });

  $$("[data-wmode]").forEach((b) => {
    b.onclick = () => {
      wordMode = b.dataset.wmode;
      $$("[data-wmode]").forEach((x) => x.classList.toggle("on", x === b));
    };
  });

  $("#e-words").onclick = (e) => {
    const span = e.target.closest("span[data-k]");
    if (!span) return;
    const key = span.dataset.k;
    if (wordMode === "cut") {
      const i = draft.cuts.indexOf(key);
      if (i >= 0) draft.cuts.splice(i, 1);
      else draft.cuts.push(key);
    } else {
      const w = renderer.words.find((x) => x.key === key);
      const n = w.text.replace(/[^\p{L}\p{N}']/gu, "");
      const list = draft.keywords || (draft.keywords = []);
      const i = list.findIndex((k) => k.word.toLowerCase() === n.toLowerCase());
      if (i >= 0) list.splice(i, 1);
      else list.push({ word: n, emoji: "" });
    }
    refresh();
  };

  bindSettings($("#e-settings"), "e", (k, v) => {
    st = { ...st, [k]: v };
    draft.settings = { ...(draft.settings || {}), [k]: v };
    refresh();
    if (k === "reframe" || k === "shape") loadFaces();
  });

  const setTrim = (which, val) => {
    val = Math.max(0, Math.min(maxT, Number(val) || 0));
    if (which === "start") draft.start = Math.min(val, draft.end - 1);
    else draft.end = Math.max(val, draft.start + 1);
    $("#e-start").value = draft.start.toFixed(1);
    $("#e-end").value = draft.end.toFixed(1);
    refresh();
    restart();
  };
  $("#e-start").onchange = (e) => setTrim("start", e.target.value);
  $("#e-end").onchange = (e) => setTrim("end", e.target.value);
  $$("[data-nudge]").forEach((b) => {
    b.onclick = () => setTrim(b.dataset.nudge, draft[b.dataset.nudge] + Number(b.dataset.d));
  });
  $("#e-hook").oninput = (e) => {
    draft.hook = e.target.value;
    drawNow();
  };

  $("#e-play").onclick = async () => {
    if (video.paused) {
      const r = renderer.ranges[rangeIdx];
      if (r && (video.currentTime < r.s - 0.05 || video.currentTime >= r.e)) await seekTo(r.s);
      await video.play();
      if (preview.music && st.music) {
        preview.music.volume = Math.min(1, st.musicVol);
        preview.music.play().catch(() => {});
      }
      $("#e-play").textContent = "Pause";
    } else {
      video.pause();
      if (preview.music) preview.music.pause();
      $("#e-play").textContent = "Play";
    }
  };
  $("#e-restart").onclick = () => restart();

  const collect = () => {
    draft.title = $("#e-title").value.trim() || draft.title;
    draft.hook = $("#e-hook").value.trim();
    draft.caption = $("#e-caption").value.trim();
    draft.hashtags = $("#e-tags").value.split(/[\s,]+/).map((h) => h.replace(/^#/, "")).filter(Boolean);
    draft.score = Math.max(0, Math.min(99, Number($("#e-score").value) || 0));
  };
  const commit = () => {
    collect();
    const i = state.project.clips.findIndex((c) => c.id === clip.id);
    const changed = JSON.stringify(state.project.clips[i]) !== JSON.stringify(draft);
    state.project.clips[i] = draft;
    if (changed) {
      const old = state.outputs.get(clip.id);
      if (old) URL.revokeObjectURL(old.url);
      state.outputs.delete(clip.id);
      state.thumbs.delete(clip.id);
    }
    saveProject();
  };
  $("#e-save").onclick = () => {
    commit();
    closeModal();
    renderProject();
    makeThumbs();
  };
  $("#e-save-all").onclick = () => {
    commit();
    state.project.settings = { ...(state.project.settings || {}), ...(draft.settings || {}) };
    for (const c of state.project.clips) {
      c.settings = null;
      const old = state.outputs.get(c.id);
      if (old) URL.revokeObjectURL(old.url);
      state.outputs.delete(c.id);
    }
    saveProject();
    closeModal();
    renderProject();
    toast("Style applied to every clip.", "good");
  };
  $("#e-delete").onclick = () => {
    if (!confirm("Delete this clip?")) return;
    state.project.clips = state.project.clips.filter((c) => c.id !== clip.id);
    saveProject();
    closeModal();
    renderProject();
  };

  (async () => {
    await fontsReady();
    drawWords();
    if (state.video) {
      video.src = state.video.url;
      await new Promise((r) => video.addEventListener("loadeddata", r, { once: true }));
      if (state.brand.musicName) {
        const blob = await idb.get("music").catch(() => null);
        if (blob && preview) {
          preview.music = new Audio(URL.createObjectURL(blob));
          preview.music.loop = true;
        }
      }
      await restart();
      loadFaces();
      requestAnimationFrame(loop);
    } else drawNow();
  })();
}

function addClip() {
  const p = state.project;
  const start = 0;
  const clip = {
    id: uid(),
    title: `Clip ${p.clips.length + 1}`,
    hook: "",
    start,
    end: Math.min(start + 30, p.segments.reduce((m, s) => Math.max(m, s.start + s.dur), 30)),
    score: 50,
    scores: null,
    reason: "",
    caption: "",
    hashtags: [],
    keywords: [],
  };
  p.clips.push(clip);
  saveProject();
  renderProject();
  openEditor(clip);
}

// ---------- Global events ----------

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  const clip = el.dataset.id && state.project?.clips.find((c) => c.id === el.dataset.id);
  switch (a) {
    case "home":
      e.preventDefault();
      location.hash = "";
      break;
    case "open-project":
      location.hash = `#/p/${el.dataset.id}`;
      break;
    case "open-brand":
      openBrand();
      break;
    case "open-accounts":
      openAccounts();
      break;
    case "open-code":
      openCode(false);
      break;
    case "close-modal":
      closeModal();
      break;
    case "sort":
      state.sort = el.dataset.sort;
      renderProject();
      break;
    case "edit":
      if (clip) openEditor(clip);
      break;
    case "render":
      if (clip) runRenders([clip]);
      break;
    case "render-all":
      runRenders(sortedClips().filter((c) => !state.outputs.has(c.id)));
      break;
    case "stop-render":
      state.rendering?.abort();
      break;
    case "download": {
      const out = clip && state.outputs.get(clip.id);
      if (!out) break;
      const link = document.createElement("a");
      link.href = out.url;
      link.download = `${(clip.title || "clip").replace(/[^\w-]+/g, "_")}.${out.mime === "video/mp4" ? "mp4" : "webm"}`;
      link.click();
      break;
    }
    case "post":
      if (!clip) break;
      if (!state.config?.posting) {
        toast("Posting isn't set up yet. See the banner at the top.", "bad");
        break;
      }
      (state.accounts ? Promise.resolve() : api("accounts").then((r) => (state.accounts = r.data)))
        .catch(() => {})
        .then(() => openPost(clip));
      break;
    case "add-clip":
      addClip();
      break;
    case "export-json": {
      const p = state.project;
      const data = { url: p.url, clips: p.clips.map(({ title, hook, start, end, score, caption, hashtags }) => ({ title, hook, start, end, score, caption, hashtags })) };
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      link.download = "clips.json";
      link.click();
      break;
    }
    case "delete-project":
      if (!confirm("Delete this project from this device?")) break;
      state.projects = state.projects.filter((x) => x.id !== state.project.id);
      saveProjects();
      location.hash = "";
      break;
  }
});

$("#modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#modal").hidden) closeModal();
});
window.addEventListener("beforeunload", (e) => {
  if (state.rendering) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.addEventListener("hashchange", route);

loadLogo();
route();
loadConfig();
