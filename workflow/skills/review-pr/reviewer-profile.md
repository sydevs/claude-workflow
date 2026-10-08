# Reviewer profile — how Ardnived reviews

> This is a living document. `/workflow:review-pr` reads it at review time. Only the
> Sunday `improve-loop` survey refines it, and only on recurring evidence. It was seeded on 2026-09-02
> from the reviewer's full review history across the five sydevs repos: 55 inline review comments,
> 32 reviews, 33 PR-conversation comments. Two caveats apply permanently. `claude-workflow` PRs
> merge **without formal reviews** — feedback arrives as ticket comments instead. And some
> comments under this login are loop-written text, recognisable by its long, structured,
> self-narrating format. Only human-voiced items informed this profile. Every claim below carries
> at least one PR link.

## Values, ranked

1. **Every layer must pay rent.** The single most repeated question, asked of files, components,
   hooks, helpers, types and constants alike: *does this need to exist?* — "Do we need a whole
   separate file for this function?" ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653)),
   "Having a whole separate hook for this feels like overkill"
   ([SahajAtlasWeb#181](https://github.com/sydevs/SahajAtlasWeb/pull/181)), "Won't it be simpler
   and more readable to just declare this inline, with less indirection"
   ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653)). The taste is **bimodal**:
   either fold the thing into its one caller, or make it a genuinely generic helper others will
   reuse — "Either fold it in to prepareUserMessage.ts or split it out to a generic helper"
   ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653)),
   "rewrite this into a generic helper in the `lib` folder"
   ([SahajAtlasWeb#181](https://github.com/sydevs/SahajAtlasWeb/pull/181)). A single-purpose
   middle layer is the thing they never accept.

   That is the question asked of one layer. They ask it of three wider things too, and a diff can
   answer every narrow reading and still fail a wide one, so **read the widest first.**

   **The total.** Count the bespoke pieces a diff adds against one boundary. Where there are
   several, the finding is the approach rather than any piece of it: a per-piece justification
   does not answer it, because every piece can be necessary under an approach that is not. Ask
   what a different approach, an upstream fix or an established library would make unnecessary,
   and name the number — three helpers, two stylesheets, a polling loop. On
   [SahajAtlasWeb#243](https://github.com/sydevs/SahajAtlasWeb/pull/243), which moved the widget
   into a shadow root, and [#247](https://github.com/sydevs/SahajAtlasWeb/pull/247), which took
   Tailwind to v4, every piece was individually forced by a measured platform constraint, this
   review passed clean on all six threads, and the reviewer asked about the aggregate anyway:
   *"It seems like we are having to add a lot of helpers and things to deal with the shadow DOM.
   Is there any lightweight library or package that we could rely on… for all kinds of
   operations?"*, *"This system seems a bit overcomplicated. Why do we need JavaScript to insert
   our CSS?"*, *"Is this definitely necessary? Is there no more elegant or streamlined way to
   handle this without waking / looping?"* (#243); *"Is this file still necessary? Is this a
   migration artifact… or change our approach to avoid needing this file?"*, twice, and *"This
   re-explanation is very unnecessary and is adding extra load to our documentation"* (#247).
   This needs several pieces — a diff that adds one is the layer reading above.

   **Membership, where the diff itself creates the shared owner.** Read the diff whole before
   reading it file by file. When it introduces a plugin, a layout or a helper module, every
   sibling it leaves outside is a finding until you can say why it stayed out: *"Shouldn't this
   endpoint and also the `requestLink` endpoint be part of the `login` plugin and then attached
   to any auth collection that the plugin manages?"*, *"Couldn't this be done generically within
   the plugin for any consumer?"*, *"It seems like we are off-loading too much to each
   collection"* ([SahajCloud#847](https://github.com/sydevs/SahajCloud/pull/847)), *"Change
   CardShell to something a bit more generic… Make it a layout which can be used by all public
   frontend pages"* ([#849](https://github.com/sydevs/SahajCloud/pull/849)), a generic
   `createSession(slug, id)` ([#846](https://github.com/sydevs/SahajCloud/pull/846)), and the
   strip hook they moved out of `Clients` into `accessPlugin`
   ([#826](https://github.com/sydevs/SahajCloud/pull/826)). This reading proposes no new layer and
   asks only who belongs in the one the diff built. Their prior is strong — #826 and #846 were
   both rebutted first and adopted after the reviewer repeated themselves — so a rebuttal needs a
   reason the shared owner *cannot* hold the thing, not a reason the caller may. **Not evidence
   for it:** the same PRs' *"what is the difference between X and Y"* questions and the renames
   that followed them. The reviewer says those were them learning new code, not a design both
   things shared. Do not turn such a question into a duplication finding.

   **Guards, where the piece is a protection.** **Weigh whether a protection should exist before
   weighing its shape.** A defence against a harm nobody has measured is permanent code, and they
   would rather carry the risk. This review asked for an in-process dedupe window on
   [SahajCloud#761](https://github.com/sydevs/SahajCloud/pull/761) to bound Sentry volume; the
   author built it and the reviewer deleted it — *"Drop the dedupe window… no other fancy features
   like deduping."* On [#765](https://github.com/sydevs/SahajCloud/pull/765) this review argued
   about *how* to build a cross-locale read redaction, blunt shape versus reusing the field walk,
   and never asked whether it should exist; the reviewer removed it whole — *"not sensitive… an
   unnecessary complication which could create more issues for us going forward."* On
   [#774](https://github.com/sydevs/SahajCloud/pull/774) it passed a defaulting wrapper clean —
   *"This whole function is a completely useless and unnecessary indirection."* And **never
   propose machinery against a harm you have not counted**: that is the machinery this review
   would flag in the author's own diff. Report the exposure, name what bounds it outside the repo,
   and leave the build to them. Rate limits, caches, dedupe windows, retries and redactions are
   the shapes this keeps arriving in.
2. **Work with the platform, never against it.** Custom code for a problem the framework already
   solves is a defect, not a preference: use Payload's `jsonSchema` over a custom validator,
   `minLength`/`maxLength` over hand-rolling, override `Input` not `Field`
   ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653)); "a system that works
   in-line with PayloadCMS instead of fighting it"
   ([SahajCloud#668](https://github.com/sydevs/SahajCloud/pull/668)); a parallel reimplementation
   of a built-in is "definitely not an acceptable solution"
   ([SahajCloud#469](https://github.com/sydevs/SahajCloud/pull/469)); "any plugins or
   configurations for Vike that could handle this instead of all this custom code?"
   ([WeMeditateWeb#72](https://github.com/sydevs/WeMeditateWeb/pull/72)). Preference order:
   built-in → small established library → own code, and own code needs a reason.
3. **When complexity accretes, fix the system, not the symptom.** "Take a step back and consider
   our whole system more holistically" ([SahajCloud#668](https://github.com/sydevs/SahajCloud/pull/668)),
   "Is there any higher level where we could handle this so that we don't have to create 3
   separate hooks?" (same PR). A fix that is right locally but leaves the friction in place gets
   sent back, and a good local finding is expected to generalise — "analyze all other admin
   components along these lines" ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653)),
   "File a new ticket to search the entire codebase for these kinds of unnecessary type
   redefinitions" ([SahajCloud#668](https://github.com/sydevs/SahajCloud/pull/668)).
4. **Generated types are the source of truth.** Redeclaring what `payload-types.ts` (or a
   component's own exported types) already provides is always flagged: "Why are we reconstructing
   this type instead of importing from payload-types.ts?"
   ([SahajCloud#668](https://github.com/sydevs/SahajCloud/pull/668)), "couldn't we just use
   `Banner['type']`?" ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653)) — and the
   fix belongs at the import site, "not re-exporting through this file"
   ([SahajCloud#668](https://github.com/sydevs/SahajCloud/pull/668)).
5. **Host- and user-facing surfaces must be robust and considered.** URL/embed contracts must
   survive a hostile host page — "our URLs are currently incredibly brittle… The host website
   could easily run JS that mangles the `atlas` param"
   ([SahajAtlasWeb#181](https://github.com/sydevs/SahajAtlasWeb/pull/181)) — and UI changes are
   reviewed as product: exact copy rewrites supplied, banner placement corrected twice, a
   competing element suppressed "to avoid overwhelming the interface" (same PR).

## What they flag most often

- Unnecessary files, components, hooks, wrappers, constants — indirection of every size
  ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653),
  [SahajAtlasWeb#181](https://github.com/sydevs/SahajAtlasWeb/pull/181)).
- Hand-rolled solutions where a framework mechanism, existing component, or small library exists
  ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653),
  [SahajCloud#469](https://github.com/sydevs/SahajCloud/pull/469),
  [WeMeditateWeb#72](https://github.com/sydevs/WeMeditateWeb/pull/72)).
- Type redefinition and type mismatches papered over with mapping code
  ([SahajCloud#668](https://github.com/sydevs/SahajCloud/pull/668),
  [SahajAtlasWeb#184](https://github.com/sydevs/SahajAtlasWeb/pull/184) — "Shouldn't
  CAPTCHA_REFUSED just be one kind of RegistrationRefusedError?").
- Comments that over-explain, narrate history, or describe removed systems — "Remove this
  description of the old system" ([SahajAtlasWeb#184](https://github.com/sydevs/SahajAtlasWeb/pull/184)),
  "This comment looks unnecessary" ([SahajCloud#675](https://github.com/sydevs/SahajCloud/pull/675));
  likewise technical detail in design-system stories
  ([SahajAtlasWeb#184](https://github.com/sydevs/SahajAtlasWeb/pull/184)).
- Copy and interaction details on user-facing changes, with concrete replacement text
  ([SahajAtlasWeb#181](https://github.com/sydevs/SahajAtlasWeb/pull/181)).

## What they rarely flag — do not manufacture findings here

- **Style and formatting.** Near-absent from the corpus. Hooks and the author-side review own
  this. **Naming is not in this list — see the 2026-09-20 refinement below.**
- **Test coverage volume.** No "add more tests" comment appears anywhere in the history.
- **Performance micro-optimisation.** Never raised except where it is really a simplicity issue.
- **Defensive edge-case handling.** They accept dropping a validation when it buys simplicity —
  "We don't need the 4000-char validation if it lets us simplify the implementation"
  ([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653)).

## How they decide

Questions first, verdicts second. Most findings arrive as genuine questions — "Is this really
necessary?", "Are we sure this is the right approach? … give me your recommendation"
([SahajCloud#675](https://github.com/sydevs/SahajCloud/pull/675)) — and a well-argued answer wins:
"Go ahead with your recommendation", "Okay, we can leave it as is for now"
([SahajCloud#653](https://github.com/sydevs/SahajCloud/pull/653)). Push-back is explicitly
invited ("Push back if needed" — [SahajAtlasWeb#181](https://github.com/sydevs/SahajAtlasWeb/pull/181)).
But when the architecture itself is wrong, the verdict is total and unhedged: "This solution was
far too complicated" ([SahajCloud#354](https://github.com/sydevs/SahajCloud/issues/354)),
"This is not the right solution, closing"
([SahajAtlasWeb#172](https://github.com/sydevs/SahajAtlasWeb/pull/172)). **The review should
therefore ask sharp, answerable questions for judgement calls, and reserve flat assertions for
shape-level problems.**

## Repo-specific sensitivities

- **SahajCloud** — Payload-native mechanisms above all: `jsonSchema`, field validators, the right
  admin-component override point, `payload-types.ts` imports, `populate`/`defaultPopulate`
  discipline ([SahajCloud#535](https://github.com/sydevs/SahajCloud/pull/535)).
- **SahajAtlasWeb** — design-system stories stay non-technical; the embed/URL contract is
  host-hostile territory and must be robust; UI copy is reviewed word by word
  ([SahajAtlasWeb#181](https://github.com/sydevs/SahajAtlasWeb/pull/181),
  [#184](https://github.com/sydevs/SahajAtlasWeb/pull/184)).
- **WeMeditateWeb** — reach for Vike/ecosystem solutions before custom code
  ([WeMeditateWeb#72](https://github.com/sydevs/WeMeditateWeb/pull/72)).
- **SahajAtlasWordpress** — essentially no review history; no learned sensitivities yet.
- **claude-workflow** — merged without formal reviews; reviewer judgement arrives on tickets and
  in merge decisions instead.

## Recent refinements

<!-- Appended by /workflow:improve-loop, newest first, one dated bullet per refinement, each citing
     the PRs behind it. When several bullets turn out to be one value, fold them into the
     section above where that value belongs and delete the bullets. -->

- **2026-09-20 — a name is a claim, and a wrong one is a wrong claim.** The profile said naming
  was near-absent and told the review not to manufacture findings there. Three PRs in one week
  say otherwise, and this review passed every one of them clean on naming.
  [WeMeditateWeb#107](https://github.com/sydevs/WeMeditateWeb/pull/107) came back
  `CHANGES_REQUESTED` on nothing else: *"`readCms` seems like a confusing function name for a
  method which is supposed to handle retry, plus isn't there already a `withRetry` function?
  Basically, `readCms` is a badly named function."* On
  [SahajAtlasWeb#213](https://github.com/sydevs/SahajAtlasWeb/pull/213), four: two renames with
  the replacement supplied, and the shape behind them — *"We seem to have some conflicting and
  overlapping naming conventions between `Report`, `Registration`, and `Submission`… shouldn't
  they be unified under a common name? Probably this should be `UserSubmission` for consistency
  with the CMS."* On [WeMeditateWeb#112](https://github.com/sydevs/WeMeditateWeb/pull/112): *"I
  also don't like the name `cms-forms`, this is generally an unclear naming convention"*, and
  *"The name of this story is still incorrectly set to 'CMS Form'"*.
  This is not taste. It is value 4 — the generated types are the source of truth — applied to
  vocabulary: **a name must say what the thing does, in the words the system already uses.**
  `readCms` claimed a read and did a retry, beside an existing `withRetry`. The atlas types
  claimed `Registration` for a guard that refuses every submission kind, while the CMS collection
  next door was already called `user-submissions`. So flag a name that describes the wrong thing,
  shadows an existing helper, or invents a second word for something the CMS or a sibling repo
  has already named — and supply the replacement, as they do. Leave spelling, casing and
  house-style alone; those are still the hooks' job.
