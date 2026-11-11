# Clip Cutter

An AI clipping studio in the style of Opus Clip. Paste a video link (YouTube, TikTok, Instagram, Facebook or X). Clip Cutter reads the transcript, uses Claude to find and score the best moments, auto-edits them into vertical clips, and posts them to your TikTok, Instagram, YouTube, Facebook and X accounts.

## Features

| Feature | What it does |
|---|---|
| Virality score | Every clip rated 0–99, with hook, flow, value and shareability sub-scores. Sort by score or timeline. |
| Animated captions | Six styles (Bold, Beast, Karaoke, Clean, Pop, Subtle), word-by-word highlight, your highlight colour, size and position. |
| Key words and emojis | The AI picks words to emphasise. They change colour, trigger a zoom, and pop an emoji. |
| AI reframe | Face tracking follows the speaker. With two people on screen, Auto switches to split screen. Falls back to a blurred fill when no faces are found. |
| Auto editor | Removes pauses, cuts "um" and "uh" (beta), punch-in zooms on the beat, hook title, progress bar. |
| Text-based editing | Tap any word in the transcript to cut it from the clip. |
| Shapes | 9:16, 4:5, 1:1 and 16:9, in 720p or 1080p. |
| Brand kit | Logo, caption style, colour and auto-editor defaults saved for every new clip. Background music that dips under speech. |
| Posting | Post now or schedule to TikTok, Instagram Reels, YouTube Shorts, Facebook and X. |
| Projects | Your last 8 projects are saved on your device. Re-add the video file to keep editing. |

Not included: AI B-roll, translated captions, AI voice-over, and long-form editing of a whole video. Face tracking loads Google's MediaPipe face detector from public CDNs the first time it's used. If those are blocked, clips use a centred or blurred layout instead.

## How it works

1. **Connect your accounts** once (TikTok, Instagram, YouTube, Facebook, X).
2. **Paste a link.** The site gets the transcript and Claude picks the best moments, with a hook line and a post caption for each.
3. **Add the video file.** Websites can't pull video files out of YouTube or TikTok, so this one step needs the file. Clipping campaigns usually share it.
4. **Render & post.** Turn on "Post each clip as soon as it finishes rendering" and every clip goes out to the accounts you switched on. Or post them one by one with **Post now**.

Rendering happens on your device. Finished clips are uploaded to your own Vercel storage for a moment so the posting service can fetch them, then deleted.

## What you need

| Thing | Where | Cost |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Pay per use. A few cents per video. |
| `SUPADATA_API_KEY` | supadata.ai → Dashboard | Free: 100 credits a month |
| `UPLOADPOST_API_KEY` | upload-post.com → API Keys | Free: 10 uploads a month. Each post to one account counts. |
| A Blob store | Vercel → Storage | Free on the Hobby plan, within its limits |
| `ACCESS_CODE` | You make it up | Free |

**`ACCESS_CODE` is required for posting.** Without it, anyone who finds your site could post to your accounts, so posting stays switched off until you set one.

## Deploy on Vercel

1. **Put the code on GitHub.** Create a new repository on github.com and upload everything in this folder except `node_modules` (drag and drop works on the GitHub website).
2. **Import it into Vercel.** vercel.com → Add New → Project → pick the repository. Framework preset: **Other**. Leave the build settings empty.
3. **Add the keys.** In Environment Variables, add `ANTHROPIC_API_KEY`, `SUPADATA_API_KEY`, `UPLOADPOST_API_KEY` and `ACCESS_CODE`. Click **Deploy**.
4. **Add storage.** In your project, open **Storage → Create Database → Blob**. Set access to **Public** (the posting service has to download each clip from it) and tick **Add a read-write token env var to this connection**, so Vercel adds `BLOB_READ_WRITE_TOKEN`. Then go to **Deployments** and **Redeploy** the latest one.
5. **Connect your accounts.** Open your site, enter the access code, and tap **Connect accounts**. Sign in to each platform, then tap **Back to Clip Cutter**.

## Costs and limits on Vercel's free plan

Vercel's free **Hobby** plan runs the `api/` functions at no cost, within its monthly limits. Hobby is for personal, non-commercial use, so if you clip for paid campaigns, Vercel expects you to be on the Pro plan. Rendering happens in your browser, so it doesn't use Vercel's limits. Keep the tab open while clips render: each one takes about as long as the clip itself.

GitHub Pages can't run this app, because the `api/` functions need a server to keep your keys secret.

## Platform rules to know

| Platform | Rule |
|---|---|
| Instagram | Must be a **Business or Creator** account linked to a Facebook Page. Personal accounts can't be posted to by apps. |
| TikTok | Some accounts only allow certain privacy settings for app posts. If a post fails, try "Only me" first to test. |
| YouTube | Vertical clips under 60 seconds become Shorts. |
| All | Instagram and TikTok want **MP4**. Chrome, Edge and Safari make MP4. Firefox makes WebM, which may be rejected. |

**Test with private posts first.** Set TikTok privacy to "Only me (test)" and YouTube to "Private (test)" for your first run.

## Optional settings

- `UPLOADPOST_USER`: the profile name on Upload-Post. Default: `clip-cutter`.
- `CLAUDE_MODEL`: use a different Claude model. Default: `claude-sonnet-5-5`. If Claude's safety check declines a transcript, the request is retried on a fallback model automatically.

## Files

```
api/config.js        tells the page which features are set up (never returns keys)
api/transcript.js    link → transcript (Supadata)
api/moments.js       transcript → moments, hooks and captions (Claude)
api/accounts.js      shows connected accounts; opens the connect page (Upload-Post)
api/blob-upload.js   lets the browser upload a finished clip to your Blob store
api/post.js          posts a clip to the accounts you picked
api/post-status.js   checks whether a post went through, then deletes the stored clip
api/_lib.js, api/_upost.js   shared helpers and access-code checks
public/index.html    the page layout
public/css/app.css   the look
public/js/app.js     the app: projects, clip grid, editor, posting, brand kit
public/js/engine.js  the renderer: reframe, captions, zooms, jump cuts, music, export
public/js/faces.js   face tracking and thumbnails
public/vendor/blob-client.js   bundled upload helper from the @vercel/blob package
                               (rebuild: npx esbuild with `export { upload } from "@vercel/blob/client"`)
tools/clip_cutter.py optional computer script: download + cut with ffmpeg
```

## If something goes wrong

| Message | Fix |
|---|---|
| "Setup needed" banner | Add what it lists in Vercel, then redeploy. |
| Accounts panel says "not connected" after connecting | Tap Connect accounts again and finish every step, or reload the page. |
| Instagram: failed | Switch the account to Business or Creator and link a Facebook Page, then reconnect. |
| "limit is used up" | You've hit your Upload-Post plan's monthly uploads. Wait or upgrade. |
| "no captions and none could be made" | Use "Paste the transcript yourself instead". |
| Clips render silent | The browser blocked audio. Use Chrome or Edge on a computer. |

## Fair use

Only clip and post videos you own or have permission to use, such as a clipping campaign's source video. Posting other people's content without permission breaks YouTube's, TikTok's and Instagram's rules and can get your accounts banned. Most campaigns also have their own caption and hashtag rules. Put those in "Add to every caption".
