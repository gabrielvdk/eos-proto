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
  - Goal modal: title, **Team** (Hoogendoorn, a department or a team — the goal's level is derived from it via `levelOf()`, shown as a pill; there is no Type field), "Linked to goal" picker, description, deliverables, change history.
- **Rocks** tab: 90-day rocks per quarter (`QUARTERS` constant), filterable by team.
  - Owner avatar, status (Not Set / On-Track / Off-Track / Off-Track Escalate / Done / Cancelled), milestone progress bar (done / overdue / to do), last update, linked goal (tooltip shows full goal chain).
  - Expand a rock to edit milestones inline (title, done toggle, deadline, per-milestone updates, delete).
  - Quick-update popover on rocks and milestones; rock modal with Updates and History tabs.
- **Rock Review** tab: meeting view. Rows = rocks of the selected quarter/team; columns = ISO weeks (header: "Wk n" + Monday date) spanning the quarter, widened to include every milestone deadline.
  - Past week headers red-soft, current week solid accent (and tinted column), future weeks plain.
  - Each dated milestone is a chip in its deadline week (done / overdue / due ≤7 days / to do); clicking a chip toggles done.
  - Left column per rock: owner, title, team tag (hidden when a team is filtered), update icon (hover = latest update, click = quick-update popover), status dropdown, progress bar.
  - Layout is two tables side by side (`.rr-left` fixed, `.rr-right` inside `.rr-scroll`) so only the weeks scroll; `syncReviewRows()` equalises row heights after each render. The update popover is rendered outside the tables so rows can't cover it.
  - Horizontal scroll is kept across re-renders (`rrScroll`); entering the view or changing quarter jumps to the current week.
- Rock modal: left tabs **Details · Milestones** (`modalState.left`), right tabs **Updates · History** (`modalState.tab`).
  - Milestones tab: round done-checkbox, inline name, compact date label that opens the native picker (`showPicker()` on a hidden date input), delete on hover; Enter jumps to the next milestone / adds one. Edits live on the modal's working copy and are saved (and logged to history) with "Save changes".
  - `syncRockFields()` is a no-op when the Details tab isn't rendered; call it before every redraw.
  - Goal pickers share one component, `initGoalPicker(id, {get, set, groups, emptyText})`:
    - Rock "Contributes to goal" (`rockGoalGroups`): all goals — own team → own department → Company → own department's other teams → other departments (each with its department + team goals). Writes `r.goalId` directly.
    - Goal "Linked to goal" (`initLinkedPicker`): only higher levels, never self/descendants. Team goal → own department → Company → other departments; Department goal → Company; Company goal → nothing.
    - They only filter once the user types (`typed` flag), not on the pre-filled current value.
- Status is changed via a custom menu (`#stmenu`, `openStatusMenu()` / `setStatus()`), not a native `<select>` — the Windows select popup can't be styled.
- Light/dark theme follows the OS (`prefers-color-scheme`).

## Data & storage
- All state lives in one object `S = {people, departments, goals, rocks, quarter}`.
- Persisted to the browser's `localStorage` under key `goals-rocks-v7`. Data is per browser/per device — **not shared** between users. Bump the key when the data shape changes.
- **Organisation (real):** `S.departments = [{name, teams[]}]` — Product & Technology (Data Science, Research, LG Dev, IIVO Dev, Hardware, Controls), Operations (Engineering, IIVO Helpdesk, LG Service Desk, Customer Success, Contracts, T&C), Sales (Project Sales, Direct Sales), Finance (Legal, Accounting, Business Strategy), HR (HR). Above them: "Company".
  - Goals and rocks store a *unit* name in `.team`: `COMPANY` ("Hoogendoorn" — the single company; the *level* is still called "Company"), a department name, or a team name. A team named like its department (HR) counts as the department and is listed once. `migrate()` renames the old "Company" unit on load.
  - Helpers: `deptOf(unit)`, `isDept(unit)`, `unitMatches(unit, filter)` (a department filter includes its teams), `levelOf(unit)`, `unitOptions(selected)` (all units as grouped `<option>`s).
- `seed()` contains sample goals/rocks (fictional content, real team names) and fictional people; "Reset sample data" restores it.
- People and the org structure are hard-coded in `seed()`; there is no UI to manage them yet.
- `ME = "p1"` is a placeholder for the current user (used in history entries). There is no login.
- `YEAR` and `QUARTERS` are hard-coded constants.

## Code layout (inside the `<script>`)
data/seed → load/save → UI state → helpers → shared renderers → `renderPlan` / `goalRow` → `renderRocks` / `rockRow` → `render()` → modals (`goalModal`, `rockModal`, `initParentCombo`) → event handlers (delegated on `#app` and `#modal` via `data-act` / `data-m` attributes).

Rendering is "re-render everything": change `S`, call `save()` and `render()`.

## Conventions
- Colors are CSS variables on `:root`, with dark-mode overrides; use the tokens rather than hard-coded colors.
- Always escape user text with `esc()` when building HTML strings.
- Log meaningful changes to an item's history with `logHist(obj, text)`.
- **Never use `window.confirm()/alert()/prompt()`** — they are silently blocked in Claude Code's browser pane (and some other embedded browsers). Use `askConfirm(message, okLabel)` (returns a Promise<boolean>) for confirmations.

## Open ideas / next steps
- Current phase: **prototype** — iterate on features and UX in the single HTML file.
- Later: possibly convert into a real (multi-user) application; keep that in mind but don't over-engineer the prototype.
