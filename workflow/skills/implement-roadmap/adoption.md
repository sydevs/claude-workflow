# Absorbing existing tickets

Reference for `implement-roadmap`. A goal usually arrives with work already filed for it — the
roadmap review's cross-reference lens lists it in the Technical notes block. Absorb it rather than
file a twin, and never let it become a second child in its repo.

| The existing ticket | Do |
| --- | --- |
| **Open, no PR, and the only ticket in its repo** | It becomes that repo's child. Attach it as a sub-issue (`mcp__github__sub_issue_write`). Bring it to the child standard through `write-ticket` in `update` mode: all of the repo's work for the goal, `## Goal context`, `## Interfaces`, and the plan's `Blocked by:` order. |
| **Open, no PR, and one of several in its repo** | Pick the one closest to the repo's whole share. It becomes the child, as above, with the others' work folded in. Close each other as a duplicate, with one line linking the child. |
| **Open, and carrying `## Open questions`** | Lift each product decision to the goal's `## Open questions`, with options. Answer each fact from the code, in the child through `write-ticket` in `update` mode. The child keeps none. If a decision is lifted, stop: the goal waits on it. |
| **Open, with a PR already open** | Attach it, and leave its body alone. Its PR is mid-review. Work the goal still needs in that repo goes in one new child, blocked by it when they touch the same files. |
| **Closed, and it delivered part of the goal** | Attach it for history, so the progress bar tells the truth. |
| **Open, but off the plan** | Leave it unattached, and name it in your reply as related. |

**One parent only.** GitHub allows each issue a single parent. A ticket already under another goal
stays there; name the overlap in your reply instead.

**A Bug may be attached, never created.** A goal never files a Bug; a Bug it depends on is
attached or blocks a child.
