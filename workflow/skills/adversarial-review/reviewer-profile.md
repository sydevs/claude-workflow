# Reviewer profile — how Ardnived reviews

> Living document, read at review time by `/workflow:adversarial-review` and refined only by the
> Sunday `reflect` survey, only on recurring evidence. Seeded 2026-09-02 from the full history of
> the reviewer's review activity across the five sydevs repos: 55 inline review comments, 32
> reviews, 33 PR-conversation comments. Two corpus caveats, permanent: `claude-workflow` PRs are
> merged **without formal reviews** (feedback arrives as ticket comments), and comments from
> include loop-written text under this login —
> recognisable by its long structured self-narrating format; only human-voiced items informed
> this profile. Every claim below carries at least one PR link.

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

- **Style, formatting, naming taste.** Near-absent from the corpus (one "seems generic" naming
  question, one rename with the replacement supplied —
  [SahajAtlasWeb#184](https://github.com/sydevs/SahajAtlasWeb/pull/184),
  [SahajCloud#668](https://github.com/sydevs/SahajCloud/pull/668)). Hooks and the author-side
  review own this.
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

<!-- Appended by /workflow:reflect, newest first, one dated bullet per refinement, each citing
     the PRs behind it. When several bullets turn out to be one value, fold them into the
     section above where that value belongs and delete the bullets. -->

- *(none yet — seeded 2026-09-02)*
