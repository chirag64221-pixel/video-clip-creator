#!/usr/bin/env python3
"""Optional computer script: download a video and cut the clips from clips.json.

Use it when you'd rather cut on your computer than in the browser.

  1. In Clip Cutter, open a project and click "Export list" to save clips.json.
  2. Install yt-dlp and ffmpeg (pip install yt-dlp; ffmpeg from ffmpeg.org).
  3. Run:  python tools/clip_cutter.py clips.json
     or, with a file you already have:  python tools/clip_cutter.py clips.json --video myvideo.mp4

Clips are saved as plain 9:16 MP4s (centre crop, no captions) in ./clips/.
Only download videos you own or have permission to use.
"""
import argparse
import json
import pathlib
import re
import shutil
import subprocess
import sys


def need(tool):
    if not shutil.which(tool):
        sys.exit(f"{tool} is not installed. See the instructions at the top of this file.")


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "clip"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("clips", help="clips.json exported from Clip Cutter")
    ap.add_argument("--video", help="use this local video instead of downloading")
    ap.add_argument("--out", default="clips", help="output folder (default: clips)")
    ap.add_argument("--wide", action="store_true", help="keep the original shape instead of 9:16")
    args = ap.parse_args()

    need("ffmpeg")
    data = json.loads(pathlib.Path(args.clips).read_text(encoding="utf-8"))
    out = pathlib.Path(args.out)
    out.mkdir(exist_ok=True)

    video = args.video
    if not video:
        need("yt-dlp")
        if not data.get("url"):
            sys.exit("clips.json has no link. Pass --video with the file instead.")
        video = str(out / "source.mp4")
        subprocess.run(
            ["yt-dlp", "-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--merge-output-format", "mp4", "-o", video, data["url"]],
            check=True,
        )

    crop = [] if args.wide else ["-vf", "crop=ih*9/16:ih,scale=1080:1920"]
    for i, c in enumerate(data["clips"], 1):
        name = out / f"{i:02d}-{slug(c.get('title', 'clip'))}.mp4"
        start, end = float(c["start"]), float(c["end"])
        print(f"Cutting {name.name}  ({start:.1f}s to {end:.1f}s, score {c.get('score', '?')})")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-i", video, "-t", str(end - start),
             *crop, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
             "-movflags", "+faststart", str(name)],
            check=True,
        )
    print(f"Done. {len(data['clips'])} clips in {out}/")


if __name__ == "__main__":
    main()
