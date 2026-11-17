# badgerbox skills

A skill is a set of instructions for one kind of schoolwork. badgerbox adds the matching skill to what
it tells the AI, so the work on that tab follows those instructions.

## Add a skill

1. Copy the `_example` folder and rename the copy, for example `math-steps`. No `_` at the start.
2. Open its `SKILL.md` in Notepad.
3. Fill in the header at the top:

```
---
name: math-steps
description: one line saying what kind of work this is for
tabs: math
auto: false
---
```

4. Under the header, write the instructions in plain language.
5. Save. The next run uses it. No restart.

## The header

- `name`: a short name.
- `description`: one line. On the auto tab the AI reads this to decide if the skill fits.
- `tabs`: which badgerbox tabs always use it, separated by commas:
  `auto, math, writing, reading, science, social, language, code, online`.
- `auto`: `true` also offers it on the auto, online, social and reading tabs, where the AI uses it only
  if the assignment matches the description.

## The my voice switch

A skill named exactly `my-voice` gets an on/off switch: a row in the options on every tab of the main
screen, and a small one at the top of the walkthrough. It starts off every time badgerbox opens. When it
is on, that skill is used on whatever tab you are on; when it is off, it is not used at all. It controls
that one skill only. Every other skill in this folder is always on for its tabs.

## Good to know

- Several skills can share a tab. All of them are added.
- Keep a skill under about 12,000 characters. Anything longer is cut off.
- A skill adds to badgerbox's own rules. It cannot change the reply format badgerbox needs, so do not
  tell it to answer in a different layout.
- Folders starting with `_` are ignored.
- Skills are never sent to the browser. They stay on the computer running badgerbox.
