# Session Change Summary Design

## Purpose

Close Happy's changed-files visibility gap without turning Hexa into a file manager or exposing source by default. A user should be able to open a session card and understand which repository files changed, whether changes are staged, and the bounded insertion/deletion totals.

## Architecture

- A focused Rust module resolves a HUMHUM-known session to its canonical workspace and runs `git` with separated arguments and a fixed timeout.
- Git porcelain and numstat output are parsed into relative paths, status, staged state, and line counts. No shell command string is evaluated.
- Results are capped at 80 files. File contents and patch text are not returned in this iteration.
- Hexa loads the summary only after an explicit click and keeps loading, empty, non-repository, and retry states inside the session card.

## Interface

`get_session_change_summary(session_id)` returns:

- current branch when available;
- total changed files and whether the file list was truncated;
- bounded `path`, `status`, `staged`, `insertions`, `deletions`, and `binary` fields per file.

The command rejects unknown sessions, missing/non-directory workspaces, and non-Git directories. It never returns an absolute path.

## Verification

- Parser tests cover modified, staged, untracked, renamed, binary, and unusual path records.
- Command-level workspace tests use a temporary Git repository.
- Frontend tests cover state transitions independently from the visual component.
- Full frontend tests, production build, Rust tests, and `git diff --check` remain green.

