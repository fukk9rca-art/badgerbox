# badgerbox skills

A skill is a set of instructions for one kind of schoolwork. badgerbox adds the right skill to what it
tells the model, so each subject is done by that subject's rules.

Each skill is a folder with a `SKILL.md`:

```
skills/
  writing/SKILL.md
```

`SKILL.md` starts with a short header, then the instructions in plain language:

```
---
name: writing
description: one line saying what kind of work this is for
tabs: writing            (the badgerbox tabs that always use it, comma separated)
auto: true               (also offered on the auto tab, to be used only if the work matches)
---
The instructions.
```

Edit a skill and the next run uses it. No restart, no rebuild.
