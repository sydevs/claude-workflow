# Risk — where to look

Tuesday's rotation. Look where a failure costs the most: data written wrongly, a visitor locked
out, an error nobody hears about.

- **Correctness and edge cases** — the boundaries code converts across: dates, time zones and
  recurrence, locale and slug fallbacks, empty and paginated results, optional Payload
  relations. Collection hooks and access functions in SahajCloud run on every write.
- **Security** — public write paths first: forms, user submissions, anything a non-member can
  post. Then Payload access control against each `Clients` role, rendered CMS HTML, and secrets
  that could reach a client bundle.
- **Error handling and observability** — a `catch` that swallows, a fallback that turns a 500
  into empty data, a server path with no Sentry capture. Atlas reads must degrade, never fail —
  but a degrade that hides the cause is a finding too.
- **Test quality and coverage gaps** — behaviour a recent `Bug` broke that still has no test,
  tests that mock the unit under test, assertions that cannot fail. Name the untested behaviour
  and what breaking it would cost.
