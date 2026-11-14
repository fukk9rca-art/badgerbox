# badgerbox

The whole worksheet from one screenshot, checked. Students paste a screenshot (or a photo, PDF, text or
link), badgerbox finds every question, works each one the way their class does it, solves it a second way
to check, and flags the answers it isn't sure about. Every step is explained.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 18 or newer.

**Windows:** double-click `start-badgerbox.bat`. The first time, it asks for your Claude API key (or press
Enter to use the sample answers), then opens badgerbox in your browser. Leave the black window open while
you use it. To change the key, delete the `.env` file in this folder and start it again.

To get the newest version later, double-click `update-badgerbox.bat`. It downloads the latest files from
GitHub and leaves your API key, access keys and limits alone.

**Mac / Linux:**

```
npm start            # http://localhost:3000
npm run fake         # pretends a model is connected, to test the real code path for free
```

Put the key in a file named `.env` in this folder: `ANTHROPIC_API_KEY=sk-ant-...`. Without it, badgerbox
shows the sample answers. The `.env` file is never uploaded to GitHub.

## Access keys and daily limits

`keys.json` in this folder lists who can get in and how much they can use per day (copy
`keys.example.json` if it isn't there yet):

```
{
  "8008":        { "name": "me",    "runsPerDay": 20 },
  "sam-4417":    { "name": "sam",   "runsPerDay": 5 }
}
```

- The part in quotes on the left is the key that person types on the enter screen.
- `runsPerDay` is how many worksheets they can run per day. Follow-up questions and tl;dr get ten times that.
- Limits reset at midnight. Today's counts are in `usage.json`. Restart badgerbox after editing `keys.json`.
- This only works when badgerbox runs on your computer. Online (Vercel), limits need a database, which
  isn't built yet. Also set a spending limit on your API key in the Claude Console as a backstop.

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
| `vendor/pdfjs/` | pdf.js (Apache-2.0), used to turn PDF worksheets into page images. |
| `js/bb-plot.js` | Draws graphs (scatter + best fit, line, function, bar, histogram, box plot) and does the statistics itself. |
| `api/solve.js` | Finds and works every question, then a second pass checks each answer a different way. |
| `api/ask.js` | Answers follow-up questions in the walkthrough chat. |
| `api/tldr.js` | Builds the tl;dr: what the assignment is teaching, worked out from the class and the work. |
| `api/status.js` | Tells the pages whether a model is connected. |
| `api/key.js`, `api/_lib/keys.js` | Access keys and per-key daily limits. |
| `start-badgerbox.bat` | Double-click starter for Windows. |
| `css/site.css` | Fixes for real window sizes (Chromebooks, short screens). |

Without `ANTHROPIC_API_KEY` the API answers `{ "source": "mock" }` and the pages show the built-in
chemistry sample, so the site always works.

## Not built yet

- The per-class study guide: tl;dr summaries are saved on the device, but there is no screen to read them yet.
- Real accounts and billing. Keys and daily limits exist (`keys.json`) but are managed by hand and only enforced on your own computer.
- Model routing by subject and difficulty (one model for now).
- Past runs, classes and settings are saved in the browser on one device only, not to an account.
- Answers are placed on the student's own worksheet for screenshots, photos and PDFs of up to 10 pages.
  The model's placement is approximate, which is why answers can be dragged. A PDF comes back as a PDF made
  of page images (the text in it can no longer be selected).
- Phone layout for the main screen and walkthrough (the landing page already works on phones).
- The bookmarklet points at the placeholder `badgerbox.app`.
- `[YOUR PRICE]` on the landing page.
