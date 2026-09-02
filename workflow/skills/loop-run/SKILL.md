---
name: loop-run
description: Renamed — transition pointer only. The working-day run is now /workflow:queue-routine; the nightly run is /workflow:survey-routine. Kept so a stored routine prompt pointing at this path keeps working until both prompts are updated.
disable-model-invocation: true
allowed-tools: Read
---

# loop-run has been split and renamed

This file exists only so a routine whose stored prompt still points here does not fail. Follow the
skill for the routine you are:

- **`sydevs-survey-nightly`** (or a prompt carrying `RUN_KIND=nightly`/`--kind nightly`) → read
  `workflow/skills/survey-routine/SKILL.md` and follow it exactly.
- **Anything else** (`sydevs-loop`, or a local invocation) → read
  `workflow/skills/queue-routine/SKILL.md` and follow it exactly.

Journal that this pointer was used, under `⚠️ Failed`: it means the routine's stored prompt has not
been updated to the new path yet. Once both prompts point at the new skills, delete this file.
