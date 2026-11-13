# badgerbox

The whole worksheet from one screenshot, checked. Students paste a screenshot (or a photo, PDF, text or
link), badgerbox finds every question, works each one the way their class does it, solves it a second way
to check, and flags the answers it isn't sure about. Every step is explained.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 18 or newer.

```
npm start            # http://localhost:3000, fake answers (no model connected)
npm run fake         # pretends a model is connected, to test the real code path for free
ANTHROPIC_API_KEY=sk-ant-... npm start     # real model
```

Test access key on the enter screen: `8008`.

## Put it online (Vercel)

1. Make a free account at vercel.com and choose **Add New → Project → Import** this GitHub repo.
2. Leave the settings as they are and press **Deploy**. You get a link right away; it runs with the
   sample answers.
3. To turn the real model on: **Project → Settings → Environment Variables**, add
   `ANTHROPIC_API_KEY` with your key, then redeploy.
   Optional: `BADGERBOX_MODEL` to pick a different model (default `claude-sonnet-5-5`).

## How it's put together

| Path | What it is |
| --- | --- |
| `screens/*.dc.html` | The five screens, from the Claude Design canvas. **Edit these.** |
| `tools/build.py` | Turns `screens/` into the pages below. Run `python3 tools/build.py` after editing a screen. |
| `index.html` `enter.html` `app.html` `walkthrough.html` `states.html` | Generated pages (landing, key + agreement, main screen, walkthrough, box states). |
| `js/dc-lite.js` | Small runtime that runs the screen format in a normal browser. |
| `js/bb-api.js` | The pages' link to the backend. |
| `api/solve.js` | Finds and works every question, then a second pass checks each answer a different way. |
| `api/ask.js` | Answers follow-up questions in the walkthrough chat. |
| `api/status.js` | Tells the pages whether a model is connected. |
| `css/site.css` | Fixes for real window sizes (Chromebooks, short screens). |

Without `ANTHROPIC_API_KEY` the API answers `{ "source": "mock" }` and the pages show the built-in
chemistry sample, so the site always works.

## Not built yet

- Accounts, real access keys, usage limits and billing (`8008` is a stand-in).
- Model routing by subject and difficulty (one model for now).
- Past runs are sample data; saved classes and settings reset when the page reloads.
- Phone layout for the main screen and walkthrough (the landing page already works on phones).
- The bookmarklet points at the placeholder `badgerbox.app`.
- `[YOUR PRICE]` on the landing page.
