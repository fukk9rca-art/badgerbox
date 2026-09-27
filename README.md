# badgerbox

A drag-and-drop homework helper with a rabid-badger, hacker-terminal aesthetic.

Students drop in an assignment (typed text, a photo of a worksheet, or a link),
confirm they have teacher permission and aren't using it to cheat, and badgerbox
routes the work to a model picked for the subject and difficulty — returning the
finished answer with every step explained.

This repo is a **static front-end demo** of the product concept: the full look,
feel, and interaction flow, with a scripted example (a chemistry limiting-reagent
problem) standing in for the real model-routing backend.

## Try it

Open `index.html` in a browser (or serve the folder with any static file server —
e.g. `python3 -m http.server`), then:

1. On the splash screen, type the access key `8008` and press enter.
2. Type an assignment (or attach a file) in the badgerbox, tick the honor pledge,
   and press enter / hit `[ run ]`.
3. Open the walkthrough to see the step-by-step explanation.

## Pages

- `index.html` — splash / access-key screen
- `terminal.html` — the badgerbox itself (drop an assignment, run it)
- `results.html` — the walkthrough, with an expandable step-by-step explanation
  and a follow-up question box
- `states.html` — a static reference sheet of what the box looks like in every
  situation (typing, file attached, bad file type, missing pledge, drag-over)

## Notes

- No backend: the "run" is a scripted demo, not a real model call.
- The access key (`8008`) is a placeholder for where a paid-account key would go.
- Built with plain HTML/CSS/JS — no build step, no dependencies.
