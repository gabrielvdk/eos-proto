# EOS Tracker

A single-page tool for tracking EOS (Entrepreneurial Operating System) goals and quarterly Rocks.
Originally built as a Claude.ai artifact; the original conversation is not available, so this file is the source of context.

## What it is
- One self-contained file: `index.html` (HTML + CSS + vanilla JS, no build step, no dependencies except the Figtree and Titillium Web Google Fonts).
- Open it by double-clicking; it runs in any modern browser.
- **Preview in Claude Code's browser pane:** it can't open `file://` URLs, so serve the folder with `serve.ps1` (plain PowerShell, no Node/Python installed on this machine): run `powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1 -Port 8080` in the background, then open `http://localhost:8080`. Config is also in `.claude/launch.json` (`eos-tracker`). The server sends `no-store`, so a reload shows the latest edit.
- **Published** via GitHub Pages from the public repo `gabrielvdk/eos-proto` (branch `main`, root) → https://gabrielvdk.github.io/eos-proto/. Publishing = commit + `git push`. The page has `<meta name="robots" content="noindex, nofollow">`. Everything in the repo is public; data people enter stays in their own browser's localStorage and is never published.

## Features
- **One Year Plan** tab: goals of the selected year (`planYear`, year picker in the toolbar) at three levels (Company → Department → Team), each linked to a parent goal.
  - List view (sortable by title/level/team/linked-to) and Tree view (collapsible hierarchy).
  - Filter by level; goals not linked to a Company goal are grouped separately.
  - Goal modal: title, **Team** (the company, a department or a team — the goal's level is derived from it via `levelOf()`, shown as a pill; it is never stored), "Linked to goal" picker, description, deliverables, change history.
  - The word is **Level** everywhere (column, filter, `LEVELS`, `levelFilter`) — not "Type".
- **Team filter** (top bar, `#tf`, all views): same picker as the Team field plus "All teams"; stored in `teamFilter` (a unit id). A department includes its teams. It filters goals on the One Year Plan (tree view keeps ancestors as greyed context) and rocks on Rocks / Rock Review; new goals and rocks default to the filtered team.
- **Rocks** tab: 90-day rocks per quarter. The quarter list (`quarterList()`) is this year's quarters + Q1 of next year + every quarter that has rocks.
  - Owner avatar, status, milestone progress bar (done / overdue / to do), last update, linked goal (tooltip shows full goal chain).
  - Expand a rock to edit milestones inline (title, done toggle, deadline, per-milestone updates, delete). Inline edits are logged to the rock's history (`milestoneChanges()`, shared with the modal).
  - Quick-update popover on rocks and milestones; rock modal with Updates and History tabs.
- **Rock Review** tab: meeting view. Rows = rocks of the selected quarter/team; columns = ISO weeks (header: "Wk n" + Monday date) spanning the quarter, widened to include every milestone deadline.
  - Past week headers red-soft, current week solid accent (and tinted column), future weeks plain.
  - Each dated milestone is a chip in its deadline week (done / overdue / due ≤7 days / to do); clicking a chip toggles done.
  - Left column per rock: owner, title, team tag (hidden when that team is filtered), update icon (hover = latest update, click = quick-update popover), status button, progress bar.
  - Layout is two tables side by side (`.rr-left` fixed, `.rr-right` inside `.rr-scroll`) so only the weeks scroll; `syncReviewRows()` equalises row heights after each render. The update popover is rendered outside the tables so rows can't cover it.
  - Light-grey IDS icon (`idsBtnHTML` / `rockToIDS`): adds "Rock Review: <rock title>" to the end of the IDS column of the viewed board, else the rock's own board; hidden when neither has a board; no duplicates of an open IDS card.
  - Horizontal scroll is kept across re-renders (`rrScroll`); entering the view or changing quarter jumps to the current week.
- Rock modal: left tabs **Details · Milestones** (`modalState.left`), right tabs **Updates · History** (`modalState.tab`).
  - Milestones tab: round done-checkbox, inline name, compact date label that opens the native picker (`showPicker()` on a hidden date input), delete on hover; Enter jumps to the next milestone / adds one.
  - One "Track in <forum>" checkbox per forum with `includeTracked`.
- **Status** is changed via one shared custom menu (`#stmenu`, `openStatusMenu(btn, current, onPick)`), in lists and in the rock modal — not a native `<select>` (the Windows popup can't be styled).
- All pickers share one component, `initPicker(id, {get, set, groups, display, dotOf, allowNone})` (searchable, grouped, level dots). `initGoalPicker` wraps it for goals; `initUnitPicker` is the **Team** field in both modals (the company, then each department with its teams indented; dot = level). Its value lives in a hidden `#f-unit-id` input that fires `change`.
  - Rock "Contributes to goal" (`rockGoalGroups(unitId, year)`): goals of the rock's quarter's year — own team → own department → Company → own department's other teams → other departments.
  - Goal "Linked to goal" (`initLinkedPicker`): only higher levels of the same year, never self/descendants. Team goal → own department → Company → other departments; Department goal → Company; Company goal → nothing.
  - They only filter once the user types (`typed` flag), not on the pre-filled current value.
- **Level 10** tab (`view="l10"`, `renderL10`): the weekly EOS Level 10 meeting, **per board**. Teams and forums have a board, and so does a department without teams (HR) — see `hasBoard()` / `boardsOf()`.
  - If the team filter isn't a board, `renderL10Pick` shows one-click buttons that set `teamFilter`.
  - Fixed agenda card (`AGENDA`, 90 min); "Rock Review" jumps to that tab, "To-Do List" / "IDS" flash their column.
  - Kanban columns `COLS`: IDS · To Do · Done. Inline composer (`l10Add`, Enter adds and stays open). HTML5 drag & drop (`moveCard(id, column, beforeId)` — order = order in `S.cards`), logs "Moved from X to Y".
  - Card modal (`cardModal`/`drawCardModal`): title, column switch, owners (multi, empty by default, creator is `createdBy`), description editor, Updates/History.
  - Description is a contenteditable (`initRichText`): text pastes as plain text; pasted/dropped images are downscaled (≤1600px, PNG or JPEG if large) and embedded as data URLs. **Always pass stored HTML through `sanitizeHTML()`** (allows simple tags + `data:image/(png|jpeg|gif|webp)` only). Click an image → `openLightbox`.
- **Forums** (Business Review, the 4-weekly team-leaders meeting) are units with `kind:"forum"`. A forum behaves like a team for rocks and the Level 10 board, but has **no goals**.
  - Rocks shown for a forum (`rockMatches`): its own rocks + rocks whose `trackIn` contains the forum (if `includeTracked`) + rocks with status `escalate` (if `includeEscalated`). They stay owned by their own team; edits change the real rock. Tracked rocks show a tag with the forum's initials ("BR").
  - With a forum selected the One Year Plan shows all goals (`goalFilter()` returns ""); new goals don't default to it; the goal Team picker hides "Meetings" (`initUnitPicker(false)`).
- **Modals** all work the same way: they edit a working copy (`modalState.obj`) of the record (`modalState.orig`); `MODALS[kind].sync()` copies visible fields into it (a no-op for fields not rendered — call it before every redraw); Save writes it back and logs history. Closing (✕, Cancel, Esc, backdrop) with unsaved changes asks "Discard your unsaved changes?" (`requestCloseModal()`, compares against `modalState.snapshot`).
- Light/dark theme follows the OS (`prefers-color-scheme`) until the round toggle (fixed bottom right, `#themeBtn`) is clicked; the choice is saved in localStorage key `eos-theme` and applied by a tiny script in `<head>` before first paint.

## Data model (ready for multi-user; see the comment block "data model" in the script)
- All shared data lives in one object `S = {version, people, units, goals, rocks, cards}` (one per organisation; later: the database).
  - `units = [{id, kind:"company"|"department"|"team"|"forum", name, parentId}]` — a team's `parentId` is its department; forums also have `{includeTracked, includeEscalated}`.
  - `goals = [{id, unitId, year, title, parentId, description, deliverables, history}]` — level is derived, never stored.
  - `rocks = [{id, unitId, quarter:"Q4 2026", title, ownerId, status, goalId, trackIn:[forum id], description, deliverables, milestones:[{id, title, done, deadline, updates}], updates, history}]`.
  - `cards = [{id, unitId, column, title, description, owners[], createdBy, createdAt, updates, history}]`.
  - `updates` and `history` entries are `{at, who, text}`, newest first; `at` is an ISO timestamp (older entries may be a plain date, older updates have no `who`). Always add them via `addUpdate(obj, text)` / `logHist(obj, text)`, which fill in author and time.
  - **Everything refers to other records by id, never by name** (rename a team = change one `units` entry). Ids come from `uid()` (`crypto.randomUUID`); sample records keep short ids like `g1`, `r1`, `p1`.
  - Status and column values are **keys** (`STATUSES[].key`: `not_set`, `on_track`, `off_track`, `escalate`, `done`, `cancelled`; `COLS[].key`: `ids`, `todo`, `done`); labels are only for display (`statusOf(key).label`, `colLabel(key)`).
- Lookups: `goal(id)`, `rock(id)`, `card(id)`, `person(id)` / `personName(id)`, `unit(id)` / `unitName(id)`; organisation: `company()`, `departments()`, `teamsOf(deptId)`, `forums()`, `deptOf(id)`, `isDept(id)`, `isForum(id)`, `levelOf(id)`, `goalLevel(g)`, `unitMatches(id, filter)`, `hasBoard(id)`, `boardsOf(dept)`.
- **Session:** `session.userId` / `currentUserId()` is the signed-in user (placeholder `"p1"`; no login yet). Everything that records an author reads `currentUserId()` — SSO only has to set it.
- **Storage** (section "storage" in the script) is the only code that knows where data lives: `loadData()` / `save()` on localStorage key `eos-tracker-data`. With a backend these become API calls; the rest of the app only reads `S` and calls `save()`.
  - `migrate()` brings saved data up to `DATA_VERSION` (now 8). When the shape changes, bump `DATA_VERSION` and add a step to `migrate()` so people keep their data. `migrateV7()` converts the old name-based data (key `goals-rocks-v7`), then the old key is removed.
  - If saved data can't be read, the app shows sample data and refuses to save (`storageProblem`), so the real data is never overwritten.
  - localStorage holds ~5 MB; pasted images eat it. `save()` returns false and shows a warning toast when the quota is exceeded. (With a backend, images should become uploaded attachments instead of data URLs.)
- **Personal view settings** are kept apart from shared data: `eos-tracker-prefs` = `{teamFilter, quarter, planYear}` (`loadPrefs` / `savePrefs`, saved on every render), plus `eos-theme`.
- **Organisation (real):** Hoogendoorn (company) → Product & Technology (Data Science, Research, LG Dev, IIVO Dev, Hardware, Controls), Operations (Engineering, IIVO Helpdesk, LG Service Desk, Customer Success, Contracts, T&C), Sales (Project Sales, Direct Sales), Finance (Legal, Accounting, Business Strategy), HR (no teams: has its own board). Forum: Business Review.
- `seed()` contains sample goals/rocks/cards (fictional content, real team names, `DEMO_YEAR` 2026) and fictional people. It is only used for a browser with no saved data (clearing site data starts fresh).
- People and the org structure come from `seed()`; there is no UI to manage them yet (with SSO, people will come from the identity provider).

## Code layout (inside the `<script>`, in this order)
constants · ids & dates · session · data model & sample data · storage & migration · ui state · helpers · shared renderers · views (`renderPlan`, `renderRocks`, `renderReview`, `renderL10`) · `render()` · quick-update popover · status menu · confirm dialog · modals (goal, rock, card) · pickers · rich text · tooltips · theme · events · `init()`.

Rendering is "re-render everything": change `S`, call `save()` and `render()`. `VIEWS[view]()` builds `#app`.

Events are delegated: `data-act` inside `#app` → `APP_ACTIONS` (clicks) / `APP_CHANGES` (change events); `data-m` inside `#modal` → `MODAL_ACTIONS`. Add a handler there rather than a new listener.

## Conventions
- **Look and feel follows [DESIGN.md](DESIGN.md)**, shared with Roadmapper (`gabrielvdk/roadmap-proto`). This app is its source of truth: when you change a token or style recipe, update DESIGN.md here **and** in `../Roadmapper`. Fonts: Figtree for everything (`--font-body`), Titillium Web only for titles (`--font-title`: app name, view `h1`, modal title).
- Colors are CSS variables on `:root`, with dark-mode overrides; use the tokens rather than hard-coded colors.
- Always escape user text with `esc()` when building HTML strings.
- Log meaningful changes to an item's history with `logHist(obj, text)`; post updates with `addUpdate(obj, text)`.
- Refer to records by id; show names via `unitName()` / `personName()`.
- **Never use `window.confirm()/alert()/prompt()`** — they are silently blocked in Claude Code's browser pane (and some other embedded browsers). Use `askConfirm(message, okLabel)` (returns a Promise<boolean>) for confirmations.

## Open ideas / next steps
- Current phase: **prototype**, prepared for multi-user. Next: choose the SSO provider and database, then replace `loadData()` / `save()` with API calls and set `session.userId` from SSO.
- Still open for multi-user: team membership (who belongs to which team, so the app can default to "my team" and filter owner pickers), permissions, images as uploaded attachments, and an admin UI for people and the org structure.
