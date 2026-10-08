# Adopting existing tickets

Reference for `implement-roadmap`. A goal usually arrives with work already filed for it — the
roadmap review's cross-reference lens lists it in the notes comment. Adopt it rather than file a
twin.

| The existing ticket | Do |
| --- | --- |
| **Open, and exactly one piece of the plan** | Attach it as a sub-issue (`mcp__github__sub_issue_write`). Bring it to the child standard through `write-ticket` in `revise` semantics: `## Goal context`, `## Interfaces`, and the plan's `Blocked by:` order. |
| **Open, and larger or smaller than a piece** | Reshape it to the piece it is closest to, and file the remainder as new children. Say so on the ticket. |
| **Open, and carrying `## Open questions`** | Lift each product decision to the goal's `## Open questions`, with options. Answer each fact from the code. The child keeps none. If a decision is lifted, stop: the goal waits on it. |
| **Open, with a PR already open** | Attach it, and leave its body alone. Its PR is mid-review. |
| **Closed, and it delivered part of the goal** | Attach it for history, so the progress bar tells the truth. |
| **Open, but off the plan** | Leave it unattached, and name it in your reply as related. |

**One parent only.** GitHub allows each issue a single parent. A ticket already under another goal
stays there; name the overlap in your reply instead.

**A Bug may be attached, never created.** A goal never files a Bug; a Bug it depends on is
attached or blocks a child.
