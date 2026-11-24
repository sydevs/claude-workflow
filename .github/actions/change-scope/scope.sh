#!/usr/bin/env bash
# Writes full=true|false to $GITHUB_OUTPUT. Every failure path is full=true.
set -uo pipefail

full=true
out() { echo "full=$full" >> "${GITHUB_OUTPUT:-/dev/stdout}"; }
trap out EXIT

head=$(git rev-parse --verify --quiet HEAD) || { echo "::warning::No checkout, so running the full lane."; exit 0; }

case "$EVENT" in
  pull_request | pull_request_target)
    # GitHub's merge commit: its first parent is the base tip it merged onto.
    git rev-parse --verify --quiet "$head^2" >/dev/null || { echo "Not a merge commit, so running the full lane."; exit 0; }
    git rev-parse --verify --quiet "$head^1" >/dev/null || git fetch --quiet --no-tags --depth=2 origin "$head" || true
    base=$(git rev-parse --verify --quiet "$head^1") ;;
  merge_group)
    git cat-file -e "$MERGE_GROUP_BASE^{commit}" 2>/dev/null || git fetch --quiet --no-tags --depth=1 origin "$MERGE_GROUP_BASE" || true
    base=$(git rev-parse --verify --quiet "$MERGE_GROUP_BASE^{commit}") ;;
  *)
    echo "A $EVENT event always runs the full lane."; exit 0 ;;
esac

[ -n "${base:-}" ] || { echo "::warning::Could not read the base commit, so running the full lane."; exit 0; }
files=$(git diff --name-only "$base" "$head") || { echo "::warning::Could not diff against the base, so running the full lane."; exit 0; }
[ -n "$files" ] || { echo "Empty diff, so running the full lane."; exit 0; }

echo "Changed files:"
echo "$files" | sed 's/^/  /'
heavy=$(echo "$files" | grep -vE "$LIGHT")
if [ -z "$heavy" ]; then
  full=false
  echo "::notice title=Light lane::Every changed file matches /$LIGHT/, so the full CI lane is skipped."
else
  echo "Needs the full lane for:"
  echo "$heavy" | sed 's/^/  /'
fi
