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

## Several files, and files in the chat

- The main box takes up to 3 files at once. Every file is completed, and each one is used as context for the
  others (a vocabulary sheet informs the worksheet that uses those words). A file can be switched to
  **reference only**: it is read but not answered.
- In the walkthrough chat, `[ + file ]` (or paste, or drop) adds a file. badgerbox asks each time: **use as
  context** (questions in the chat can read it, and **redo with this context** works the answers again, 1 run)
  or **do this one too** (it is completed and added to the run, 1 run). With more than one assignment,
  questions get a letter per file (`#a1`, `#b1`) and each file downloads separately under its own name.
- The chat stays on the assignment. A real school question about another subject is not answered there; it
  points to the right tab and offers a button that carries the question over. Anything that isn't schoolwork
  gets a one-line no.

## Let friends try it (without putting it online)

1. Double-click `add-friend-key.bat` once per friend. It asks for a name and a daily limit and gives you a key.
2. Double-click `share-badgerbox.bat`. The first time it offers to install `cloudflared`, a free Cloudflare
   tool. Then it shows a link ending in `trycloudflare.com`.
3. Send each friend the link and their key.

badgerbox still runs on your computer: the API key, `keys.json` and the solving code never leave it, and
friends spend from your API key within their daily limit. The link works only while that window is open,
and it is a new link every time. Through the link, the keys printed in this repo (`8008`, `change-me-…`) are refused (they only work
on your own computer), and 15 wrong keys in 10 minutes locks the link's key check for 10 minutes.
Anyone who can open the pages can still save what their browser shows.

## One-click from Google Classroom (browser extension)

The `extension/` folder is a browser extension for Chrome, Opera GX, Edge and Brave. On an assignment page,
press its button and it:

1. takes a screenshot of the page (sent as reference),
2. downloads the attached Google Docs (as .docx), Slides (as .pptx) and Drive PDFs or images,
3. reads the transcript of YouTube videos linked or embedded on the page (or of the video you are
   watching), so questions about a video can be answered. It gets what is said, not what is shown,
4. reads the teacher's instructions and lets you edit them or leave them out,
5. opens badgerbox with all of it loaded. Press Enter to run.

To add it: open the browser's extensions page (`opera://extensions`, `chrome://extensions`), turn on
**Developer mode**, press **Load unpacked** and choose the `extension` folder. badgerbox has to be running.
It sends at most 3 files (the screenshot plus two attachments). It only talks to Google Classroom, Docs,
Drive and YouTube and to badgerbox itself (`localhost`, or a share link set under "badgerbox address"). School-managed
Chromebooks usually block extensions.

## Skills

The `skills/` folder holds instruction files that badgerbox adds to what it tells the AI, per subject tab.
It ships empty apart from an example. See `skills/README.md` for how to add one.

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
| `screens/*.dc.html` | The screens, from the Claude Design canvas. **Edit these.** `Drop` and `Answers` are the main two. |
| `tools/build.py` | Turns `screens/` into the pages below. Run `python3 tools/build.py` after editing a screen. |
| `app.html` `answers.html` | Generated: the two main screens. Drop an assignment on `app.html`; every answer, flag and fix is on `answers.html`. |
| `index.html` `enter.html` `classic.html` `walkthrough.html` `states.html` | Generated: landing, key, and the old main screen and walkthrough (still reachable from **more**). |
| `js/dc-lite.js` | Small runtime that runs the screen format in a normal browser. |
| `js/bb-api.js` | The pages' link to the backend. |
| `js/bb-sheet.js` | Writes the answers onto the student's own pages and makes the download (PDF, picture, Word, slides, or a clean answer sheet). |
| `tests/flow.test.cjs` | End-to-end test of the two main screens against the fake model (no key, no cost). How to run it is at the top of the file. |
| `vendor/pdfjs/` | pdf.js (Apache-2.0), used to turn PDF worksheets into page images. |
| `js/bb-office.js`, `vendor/office/` | Reads Word and PowerPoint files and writes answers back into them (JSZip and PptxGenJS, both MIT). |
| `js/bb-blanks.js` | Finds the blanks on a worksheet picture (answer lines, empty table cells, boxes) with plain image processing and labels them, so the model only has to say which blank an answer goes in. |
| `api/place.js` | The placement pass: given the labelled pages, says which blank each answer belongs in. |
| `js/bb-plot.js` | Draws graphs (scatter + best fit, line, function, bar, histogram, box plot) and does the statistics itself. |
| `api/solve.js` | Finds and works every question, then a second pass checks each answer a different way. |
| `api/ask.js` | Answers follow-up questions in the walkthrough chat, and turns away off-topic ones. |
| `api/tldr.js` | Builds the tl;dr: what the assignment is teaching, worked out from the class and the work. |
| `api/status.js` | Tells the pages whether a model is connected. |
| `api/key.js`, `api/_lib/keys.js` | Access keys and per-key daily limits. A run is charged by size (about 2 pages = 1 run, reference files half), shown on the run button first, and given back if nothing comes back. |
| `extension/` | Browser extension: one button sends the open assignment (screenshot, attached files, instructions) to badgerbox. |
| `skills/`, `api/_lib/skills.js` | Your own instruction files per subject tab, and the code that loads them. |
| `start-badgerbox.bat` | Double-click starter for Windows. |
| `share-badgerbox.bat`, `tools/share.mjs` | Starts badgerbox and opens a private link to this computer for friends. |
| `add-friend-key.bat`, `tools/addkey.mjs` | Makes an access key with a daily limit. |
| `css/site.css` | Fixes for real window sizes (Chromebooks, short screens). |

Without `ANTHROPIC_API_KEY` the API answers `{ "source": "mock" }` and the pages show the built-in
chemistry sample, so the site always works.

## Not built yet

- The per-class study guide: tl;dr summaries are saved on the device, but there is no screen to read them yet.
- Real accounts and billing. Keys and daily limits exist (`keys.json`) but are managed by hand and only enforced on your own computer.
- Model routing by subject and difficulty (one model for now).
- Past runs, classes and settings are saved in the browser on one device only, not to an account.
- The to-do list and the past runs panel sit in the space on the right, so they only show on wide windows (1700px and up).
- Answers are placed on the student's own worksheet for screenshots, photos and PDFs of up to 10 pages.
  The model's placement is approximate, which is why answers can be dragged. A PDF comes back as a PDF made
  of page images (the text in it can no longer be selected).
- Phone layout for the main screen and walkthrough (the landing page already works on phones).
- The auto mode bookmark opens badgerbox at whatever address you dragged it from (`localhost:3000` on your own
  computer). It cannot read Google Docs, which draws its text as a picture.
- `[YOUR PRICE]` on the landing page.
