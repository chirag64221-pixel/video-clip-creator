// The renderer: reframe, captions, zooms, jump cuts, music, export.
// Everything runs in the browser on a <canvas>.

export const SHAPES = {
  "9:16": [9, 16],
  "4:5": [4, 5],
  "1:1": [1, 1],
  "16:9": [16, 9],
};

export const DEFAULT_SETTINGS = {
  shape: "9:16",
  quality: 720,
  reframe: "auto", // auto | face | center | fit | split
  captions: true,
  capStyle: "bold", // bold | beast | karaoke | clean | pop | subtle
  capColor: "#FFE100",
  keyColor: "#2EE59D",
  capSize: 1,
  capPos: 0.7,
  keywords: true,
  emojis: true,
  removePauses: true,
  removeFillers: false,
  zooms: true,
  hookTitle: true,
  progressBar: true,
  logo: true,
  music: true,
  musicVol: 0.18,
};

export const CAPTION_STYLES = {
  bold: { label: "Bold", font: "900 {s}px Montserrat", words: 3, upper: true, stroke: 0.16, box: false },
  beast: { label: "Beast", font: "400 {s}px Anton", words: 2, upper: true, stroke: 0.2, box: false, big: 1.35, tilt: true },
  karaoke: { label: "Karaoke", font: "800 {s}px Inter", words: 6, upper: false, stroke: 0.12, box: false, fill: true },
  clean: { label: "Clean", font: "700 {s}px Inter", words: 5, upper: false, stroke: 0, box: true },
  pop: { label: "Pop", font: "900 {s}px Montserrat", words: 1, upper: true, stroke: 0.16, box: false, big: 1.5, pop: true },
  subtle: { label: "Subtle", font: "600 {s}px Inter", words: 7, upper: false, stroke: 0, box: false, small: 0.75, shadow: true, noHighlight: true },
};

const FILLER = /^(u+m+|u+h+|e+r+m+|u+h+m+|h+m+|a+h+|e+h+)[,.!?…]*$/i;
export const isFiller = (t) => FILLER.test(t.trim());

export function outputSize(settings) {
  const [a, b] = SHAPES[settings.shape] || SHAPES["9:16"];
  const short = settings.quality >= 1080 ? 1080 : 720;
  let w, h;
  if (a <= b) {
    w = short;
    h = Math.round((short * b) / a);
  } else {
    h = short;
    w = Math.round((short * a) / b);
  }
  return [w - (w % 2), h - (h % 2)];
}

// ---------- Words and timing ----------

// Spread each caption line's words across its duration, weighted by length.
export function wordsForRange(segments, start, end) {
  const out = [];
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const next = segments[si + 1];
    const s0 = seg.start;
    let dur = seg.dur || 0;
    if (!dur || dur <= 0) dur = next ? Math.max(0.3, next.start - s0) : 2;
    if (next && s0 + dur > next.start + 0.05) dur = Math.max(0.2, next.start - s0);
    const s1 = s0 + dur;
    if (s1 < start - 1 || s0 > end + 1) continue;
    const parts = seg.text.split(/\s+/).filter(Boolean);
    const weights = parts.map((p) => p.length + 2);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let t = s0;
    parts.forEach((p, wi) => {
      const d = (dur * weights[wi]) / total;
      const w = { key: `${si}:${wi}`, text: p, s: t, e: t + d };
      t += d;
      const mid = (w.s + w.e) / 2;
      if (mid >= start && mid <= end) out.push(w);
    });
  }
  return out;
}

// Turns the clip into a list of source-time ranges to keep (jump cuts).
export function buildRanges(words, clip, settings) {
  const removed = [];
  const cuts = new Set(clip.cuts || []);
  const kept = [];
  for (const w of words) {
    if (cuts.has(w.key) || (settings.removeFillers && isFiller(w.text))) {
      removed.push([w.s, w.e]);
    } else {
      kept.push(w);
    }
  }
  if (settings.removePauses) {
    for (let i = 0; i + 1 < kept.length; i++) {
      const gap = kept[i + 1].s - kept[i].e;
      if (gap > 0.6) removed.push([kept[i].e + 0.15, kept[i + 1].s - 0.12]);
    }
  }
  removed.sort((a, b) => a[0] - b[0]);
  const ranges = [];
  let cur = clip.start;
  for (const [a, b] of removed) {
    if (b <= cur) continue;
    if (a > cur) ranges.push([cur, Math.min(a, clip.end)]);
    cur = Math.max(cur, b);
    if (cur >= clip.end) break;
  }
  if (cur < clip.end) ranges.push([cur, clip.end]);
  const clean = ranges.filter(([a, b]) => b - a > 0.08);
  let off = 0;
  return clean.map(([s, e]) => {
    const r = { s, e, off };
    off += e - s;
    return r;
  });
}

export const rangesDuration = (ranges) => ranges.reduce((t, r) => t + (r.e - r.s), 0);

export function outTimeFor(ranges, src) {
  for (const r of ranges) {
    if (src < r.s) return r.off;
    if (src <= r.e) return r.off + (src - r.s);
  }
  const last = ranges[ranges.length - 1];
  return last ? last.off + (last.e - last.s) : 0;
}

// Caption "pages": the group of words on screen together.
export function buildPages(words, clip, settings) {
  const style = CAPTION_STYLES[settings.capStyle] || CAPTION_STYLES.bold;
  const cuts = new Set(clip.cuts || []);
  const kept = words.filter((w) => !cuts.has(w.key) && !(settings.removeFillers && isFiller(w.text)));
  const pages = [];
  let cur = [];
  const flush = () => {
    if (cur.length) pages.push({ words: cur, s: cur[0].s, e: cur[cur.length - 1].e });
    cur = [];
  };
  kept.forEach((w, i) => {
    const prev = kept[i - 1];
    if (cur.length && (cur.length >= style.words || (prev && w.s - prev.e > 0.5))) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.text)) flush();
  });
  flush();
  // Hold each page on screen until the next one starts (short gaps only).
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    pages[i].hold = next ? Math.min(next.s, pages[i].e + 0.6) : pages[i].e + 0.6;
  }
  return pages;
}

function keywordMap(clip) {
  const m = new Map();
  for (const k of clip.keywords || []) {
    const key = norm(k.word);
    if (key) m.set(key, k.emoji || "");
  }
  return m;
}

const norm = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

// ---------- Drawing ----------

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function coverDraw(ctx, src, vw, vh, x, y, w, h, cx, cy, zoom) {
  const scale = Math.max(w / vw, h / vh) * zoom;
  const sw = w / scale;
  const sh = h / scale;
  const sx = Math.max(0, Math.min(vw - sw, cx * vw - sw / 2));
  const sy = Math.max(0, Math.min(vh - sh, cy * vh - sh / 2));
  ctx.drawImage(src, sx, sy, sw, sh, x, y, w, h);
}

function containDraw(ctx, src, vw, vh, W, H, zoom) {
  const scale = Math.min(W / vw, H / vh) * zoom;
  const w = vw * scale;
  const h = vh * scale;
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export class Renderer {
  constructor({ canvas, clip, segments, settings, faces, logo }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.faces = faces || null; // { samples: [{t, faces:[{cx,cy,w,h}]}], ok }
    this.logo = logo || null;
    this.update(clip, segments, settings);
  }

  update(clip, segments, settings) {
    this.clip = clip;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    const [W, H] = outputSize(this.settings);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.W = W;
    this.H = H;
    this.words = wordsForRange(segments, clip.start, clip.end);
    this.ranges = buildRanges(this.words, clip, this.settings);
    this.duration = rangesDuration(this.ranges);
    this.pages = buildPages(this.words, clip, this.settings);
    this.keywords = keywordMap(clip);
  }

  faceAt(t) {
    const f = this.faces;
    if (!f || !f.samples || !f.samples.length) return null;
    const s = f.samples;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    const a = s[lo];
    const b = s[Math.min(lo + 1, s.length - 1)];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
    const lerp = (x, y) => x + (y - x) * k;
    return {
      count: a.faces.length,
      cx: lerp(a.cx, b.cx),
      cy: lerp(a.cy, b.cy),
      faces: a.faces,
    };
  }

  zoomAt(src, out) {
    if (!this.settings.zooms) return 1;
    let z = 1;
    // Punch in on emphasised words.
    if (this.settings.keywords) {
      for (const w of this.words) {
        if (w.s > src + 0.2) break;
        if (w.e + 0.5 < src) continue;
        if (!this.keywords.has(norm(w.text))) continue;
        const into = ease((src - w.s + 0.15) / 0.2);
        const outOf = 1 - ease((src - w.e - 0.2) / 0.3);
        z = Math.max(z, 1 + 0.14 * Math.min(into, outOf));
      }
    }
    // A gentle cut-zoom every few seconds keeps talking heads moving.
    const beat = Math.floor(out / 4) % 2 === 1 ? 1.07 : 1;
    return Math.max(z, beat);
  }

  // Draws one frame. src = video time, out = time in the finished clip.
  draw(video, src, out) {
    const { ctx, W, H, settings: st } = this;
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const vw = video && video.videoWidth;
    const vh = video && video.videoHeight;
    if (vw && vh) this.drawVideo(video, vw, vh, src, out);
    ctx.restore();

    if (st.captions) this.drawCaptions(src);
    if (st.hookTitle && this.clip.hook) this.drawHook(out);
    if (st.progressBar && this.duration > 0) {
      const p = Math.max(0, Math.min(1, out / this.duration));
      const h = Math.max(6, Math.round(H * 0.007));
      ctx.fillStyle = "rgba(255,255,255,.25)";
      ctx.fillRect(0, H - h, W, h);
      ctx.fillStyle = st.capColor;
      ctx.fillRect(0, H - h, W * p, h);
    }
    if (st.logo && this.logo && this.logo.complete && this.logo.naturalWidth) {
      const lw = W * 0.16;
      const lh = (lw * this.logo.naturalHeight) / this.logo.naturalWidth;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.logo, W - lw - W * 0.04, W * 0.04, lw, lh);
      ctx.globalAlpha = 1;
    }
  }

  drawVideo(video, vw, vh, src, out) {
    const { ctx, W, H, settings: st } = this;
    const zoom = this.zoomAt(src, out);
    const face = this.faceAt(src);
    const detectorOk = this.faces && this.faces.ok;
    let mode = st.reframe;
    const srcIsWider = vw / vh > W / H + 0.05;
    if (mode === "auto") {
      if (!srcIsWider) mode = "center";
      else if (!detectorOk) mode = "center";
      else if (face && face.count >= 2 && H > W) mode = "split";
      else if (face && face.count === 1) mode = "face";
      else mode = "fit";
    }
    if (mode === "split" && !(face && face.faces.length >= 2)) mode = face && face.count ? "face" : "center";
    if (mode === "face" && !(face && face.count)) mode = "center";

    if (mode === "fit") {
      ctx.save();
      ctx.filter = "blur(28px) brightness(.55)";
      coverDraw(ctx, video, vw, vh, -40, -40, W + 80, H + 80, 0.5, 0.5, 1);
      ctx.restore();
      containDraw(ctx, video, vw, vh, W, H, zoom);
    } else if (mode === "split") {
      const [a, b] = [...face.faces].sort((p, q) => p.cx - q.cx);
      coverDraw(ctx, video, vw, vh, 0, 0, W, H / 2, a.cx, a.cy, zoom * 1.15);
      coverDraw(ctx, video, vw, vh, 0, H / 2, W, H / 2, b.cx, b.cy, zoom * 1.15);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, H / 2 - 2, W, 4);
    } else if (mode === "face") {
      coverDraw(ctx, video, vw, vh, 0, 0, W, H, face.cx, Math.min(0.6, face.cy + 0.05), zoom);
    } else {
      coverDraw(ctx, video, vw, vh, 0, 0, W, H, 0.5, 0.5, zoom);
    }
  }

  drawHook(out) {
    const { ctx, W, H } = this;
    if (out > 3.2) return;
    const a = Math.min(ease(out / 0.25), 1 - ease((out - 2.8) / 0.4));
    if (a <= 0) return;
    const size = Math.round(W * 0.058);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `800 ${size}px Inter, sans-serif`;
    const lines = wrapLines(ctx, this.clip.hook, W * 0.76);
    const lh = size * 1.25;
    const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + size * 1.4;
    const boxH = lines.length * lh + size * 0.9;
    const x = (W - boxW) / 2;
    const y = H * 0.12;
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,.35)";
    ctx.shadowBlur = 20;
    roundRect(ctx, x, y, boxW, boxH, size * 0.45);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y + size * 0.45 + lh * (i + 0.5)));
    ctx.restore();
  }

  drawCaptions(src) {
    const { ctx, W, H, settings: st } = this;
    const page = this.pages.find((p) => src >= p.s - 0.05 && src < p.hold);
    if (!page) return;
    const style = CAPTION_STYLES[st.capStyle] || CAPTION_STYLES.bold;
    const size = Math.round(W * 0.075 * st.capSize * (style.big || 1) * (style.small || 1));
    ctx.save();
    ctx.font = style.font.replace("{s}", size) + ", sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const items = page.words.map((w) => {
      const text = style.upper ? w.text.toUpperCase() : w.text;
      return { w, text, width: ctx.measureText(text).width };
    });
    const space = ctx.measureText(" ").width;
    const maxW = W * 0.86;
    const lines = [];
    let line = [];
    let lw = 0;
    for (const it of items) {
      const add = (line.length ? space : 0) + it.width;
      if (line.length && lw + add > maxW) {
        lines.push({ items: line, width: lw });
        line = [];
        lw = 0;
      }
      lw += (line.length ? space : 0) + it.width;
      line.push(it);
    }
    if (line.length) lines.push({ items: line, width: lw });

    const lh = size * 1.18;
    const blockH = lines.length * lh;
    const cy = H * st.capPos;
    let y = cy - blockH / 2 + lh / 2;

    if (style.box) {
      const bw = Math.max(...lines.map((l) => l.width)) + size * 0.9;
      ctx.fillStyle = "rgba(0,0,0,.62)";
      roundRect(ctx, (W - bw) / 2, cy - blockH / 2 - size * 0.3, bw, blockH + size * 0.6, size * 0.3);
      ctx.fill();
    }

    let emoji = null;
    const popAge = src - page.s;
    for (const ln of lines) {
      let x = (W - ln.width) / 2;
      for (const it of ln.items) {
        const active = src >= it.w.s && src < it.w.e + 0.02;
        const spoken = src >= it.w.s;
        const isKey = st.keywords && this.keywords.has(norm(it.w.text));
        let color = "#fff";
        if (style.fill) color = spoken ? st.capColor : "rgba(255,255,255,.9)";
        else if (!style.noHighlight && active) color = st.capColor;
        if (isKey && !style.noHighlight) color = st.keyColor;
        let scale = 1;
        if (style.pop) scale = 0.7 + 0.3 * ease(popAge / 0.12);
        if (isKey && active && !style.subtle) scale *= 1.08;
        if (active && st.emojis && isKey && this.keywords.get(norm(it.w.text))) {
          emoji = { e: this.keywords.get(norm(it.w.text)), age: src - it.w.s };
        }
        ctx.save();
        ctx.translate(x + it.width / 2, y);
        if (style.tilt && active) ctx.rotate(-0.03);
        ctx.scale(scale, scale);
        if (style.shadow) {
          ctx.shadowColor = "rgba(0,0,0,.8)";
          ctx.shadowBlur = size * 0.25;
        }
        if (style.stroke) {
          ctx.lineJoin = "round";
          ctx.lineWidth = size * style.stroke;
          ctx.strokeStyle = "#000";
          ctx.strokeText(it.text, -it.width / 2, 0);
        }
        ctx.fillStyle = color;
        ctx.fillText(it.text, -it.width / 2, 0);
        ctx.restore();
        x += it.width + space;
      }
      y += lh;
    }

    if (emoji) {
      const es = size * 1.5 * (0.6 + 0.4 * ease(emoji.age / 0.15));
      ctx.font = `${es}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(emoji.e, W / 2, cy - blockH / 2 - es * 0.75);
    }
    ctx.restore();
  }

  // Is a word being spoken right now? (Used to dip the music under speech.)
  speaking(src) {
    return this.words.some((w) => src >= w.s - 0.1 && src <= w.e + 0.15);
  }
}

// ---------- Export ----------

export function pickMime() {
  const options = [
    "video/mp4;codecs=avc1.42E01F,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  for (const m of options) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

const once = (el, ev) => new Promise((res) => el.addEventListener(ev, res, { once: true }));

async function seek(video, t) {
  if (Math.abs(video.currentTime - t) < 0.01) return;
  const p = once(video, "seeked");
  video.currentTime = t;
  await p;
}

// Renders one clip to a video Blob in real time.
// opts: { videoUrl, clip, segments, settings, faces, logo, musicBuffer, onProgress, signal }
export async function renderClip(opts) {
  const { clip, segments, settings, faces, logo, musicBuffer, onProgress, signal } = opts;
  const mime = pickMime();
  if (!mime) throw new Error("This browser can't record video. Use Chrome or Edge.");

  const video = document.createElement("video");
  video.src = opts.videoUrl;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  await once(video, "loadedmetadata");

  const canvas = document.createElement("canvas");
  const r = new Renderer({ canvas, clip, segments, settings, faces, logo });
  if (!r.ranges.length) throw new Error("Nothing left in this clip after cuts.");

  const ac = new AudioContext();
  await ac.resume();
  const dest = ac.createMediaStreamDestination();
  const vSrc = ac.createMediaElementSource(video);
  vSrc.connect(dest);
  let musicGain = null;
  let musicNode = null;
  if (musicBuffer && r.settings.music) {
    musicNode = ac.createBufferSource();
    musicNode.buffer = musicBuffer;
    musicNode.loop = true;
    musicGain = ac.createGain();
    musicGain.gain.value = r.settings.musicVol;
    musicNode.connect(musicGain).connect(dest);
  }

  const fps = 30;
  const vStream = canvas.captureStream(fps);
  const stream = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const bitrate = r.settings.quality >= 1080 ? 10_000_000 : 6_000_000;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = once(rec, "stop");

  let range = r.ranges[0];
  let drawing = true;
  const tick = () => {
    if (!drawing) return;
    const src = video.currentTime;
    const out = range.off + Math.max(0, src - range.s);
    r.draw(video, src, out);
    if (musicGain) {
      const target = r.speaking(src) ? r.settings.musicVol * 0.35 : r.settings.musicVol;
      musicGain.gain.setTargetAtTime(target, ac.currentTime, 0.12);
    }
    if (onProgress) onProgress(Math.min(1, out / r.duration));
    requestAnimationFrame(tick);
  };

  try {
    for (let i = 0; i < r.ranges.length; i++) {
      if (signal && signal.aborted) throw new DOMException("Stopped", "AbortError");
      range = r.ranges[i];
      await seek(video, range.s);
      r.draw(video, range.s, range.off);
      if (i === 0) {
        rec.start(1000);
        if (musicNode) musicNode.start();
        requestAnimationFrame(tick);
      } else {
        rec.resume();
        if (musicNode) ac.resume();
      }
      await video.play();
      await new Promise((resolve, reject) => {
        const check = () => {
          if (signal && signal.aborted) return reject(new DOMException("Stopped", "AbortError"));
          if (video.currentTime >= range.e || video.ended) return resolve();
          if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(check);
          else requestAnimationFrame(check);
        };
        check();
      });
      video.pause();
      if (i < r.ranges.length - 1) {
        rec.pause();
        if (musicNode) await ac.suspend();
      }
    }
  } finally {
    drawing = false;
    video.pause();
    if (rec.state !== "inactive") rec.stop();
    await stopped;
    try {
      if (musicNode) musicNode.stop();
    } catch {}
    ac.close();
    video.removeAttribute("src");
    video.load();
  }
  const type = mime.split(";")[0];
  return { blob: new Blob(chunks, { type }), mime: type, duration: r.duration };
}
