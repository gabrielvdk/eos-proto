# EOS Tracker — "Goals & Rocks"

A single-page tool for tracking EOS (Entrepreneurial Operating System) goals and quarterly Rocks.
Originally built as a Claude.ai artifact; the original conversation is not available, so this file is the source of context.

## What it is
- One self-contained file: `Goals & Rocks.html` (HTML + CSS + vanilla JS, no build step, no dependencies except the Figtree Google Font).
- Open it by double-clicking; it runs in any modern browser.
- **Preview in Claude Code's browser pane:** it can't open `file://` URLs, so serve the folder with `serve.ps1` (plain PowerShell, no Node/Python installed on this machine): run `powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8080` in the background, then open `http://localhost:8080`. Config is also in `.claude/launch.json` (`eos-tracker`). The server sends `no-store`, so a reload shows the latest edit.

## Features
- **One Year Plan** tab: goals at three levels (Company → Department → Team), each linked to a parent goal.
  - List view (sortable by title/type/team/linked-to) and Tree view (collapsible hierarchy).
  - Filter by level; goals not linked to a Company goal are grouped separately.
  - Goal modal: title, type, team, searchable nested "Linked to" picker (only higher levels allowed, no cycles), description, deliverables, change history.
- **Rocks** tab: 90-day rocks per quarter (`QUARTERS` constant), filterable by team.
  - Owner avatar, status (Not Set / On-Track / Off-Track / Off-Track Escalate / Done / Cancelled), milestone progress bar (done / overdue / to do), last update, linked goal (tooltip shows full goal chain).
  - Expand a rock to edit milestones inline (title, done toggle, deadline, per-milestone updates, delete).
  - Quick-update popover on rocks and milestones; rock modal with Updates and History tabs.
- Light/dark theme follows the OS (`prefers-color-scheme`).

## Data & storage
- All state lives in one object `S = {people, teams, goals, rocks, quarter}`.
- Persisted to the browser's `localStorage` under key `goals-rocks-v6`. Data is per browser/per device — **not shared** between users. Bump the key when the data shape changes.
- `seed()` contains fictional sample data (people, teams, goals, rocks); the "Reset sample data" button restores it.
- People and teams are hard-coded in `seed()`; there is no UI to manage them yet.
- `ME = "p1"` is a placeholder for the current user (used in history entries). There is no login.
- `YEAR` and `QUARTERS` are hard-coded constants.

## Code layout (inside the `<script>`)
data/seed → load/save → UI state → helpers → shared renderers → `renderPlan` / `goalRow` → `renderRocks` / `rockRow` → `render()` → modals (`goalModal`, `rockModal`, `initParentCombo`) → event handlers (delegated on `#app` and `#modal` via `data-act` / `data-m` attributes).

Rendering is "re-render everything": change `S`, call `save()` and `render()`.

## Conventions
- Colors are CSS variables on `:root`, with dark-mode overrides; use the tokens rather than hard-coded colors.
- Always escape user text with `esc()` when building HTML strings.
- Log meaningful changes to an item's history with `logHist(obj, text)`.

## Open ideas / next steps
- Current phase: **prototype** — iterate on features and UX in the single HTML file.
- Later: possibly convert into a real (multi-user) application; keep that in mind but don't over-engineer the prototype.
