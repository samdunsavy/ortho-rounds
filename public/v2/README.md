# v2 preview client — how to work on it

Served at `/v2/`. The main app at `/` is untouched: `public/index.html` and
`public/app.js` are never modified by v2 work.

## Files

| File | Responsibility |
|---|---|
| `index.html` | Shell markup + icon sprite. No logic. |
| `css/tokens.css` | The only file that declares colour variables. Both themes. |
| `css/base.css` | Reset, typography, focus, reduced-motion, print. |
| `css/shell.css` | App grid, rail, header, spine, panes, bottom nav, breakpoints. |
| `css/card.css` · `detail.css` · `board.css` · `overlay.css` | Component layers. |
| `data.js` | API client + view-model normalisation. **No DOM.** |
| `render.js` | Pure fragment builders. **No DOM, no state, no globals.** |
| `app.js` | State, event delegation, view switching. Owns all DOM. |

Three breakpoint tiers only — 760, 1100, 1300. Adding a fourth is a defect;
a test enforces this.

## Rules that exist because breaking them shipped a bug

**Escape everything patient-supplied**, in attribute position as well as
text. `render.js` exports `esc`. These are real records.

**Never reimplement clinical-day arithmetic.** `public/milestones.js` owns
POD, milestone due/overdue windows and `milestoneDayPrefix`. v2 reaches it
through the `deps` parameter (defaults to `globalThis`).

**Status values are `preop` / `conservative` / `postop` / `fordischarge`**
(`public/app.js:13-14`). The prototype used different words; that drift
made every for-discharge patient invisible on the board. Real records also
carry **no status at all** — production has some — so `data.js` normalises
`raw.status || 'preop'` before any renderer sees it, matching the main
app's own default. Anything filtering on exact status values must consume
the view model, never the raw record. A test asserts every ward patient
lands in exactly one board column.

**Writes go through `enqueueWrite`.** It serialises `loadWard() → mutate →
pushPatient()` so two writes cannot interleave. It took three rounds to get
right — read the comments before changing it. The server (`merge.js`) is the
sole reconciler; do not add client-side merging.

**Bump the version stamp on every asset change.** `?v=N` in `index.html`
and `const BUILD = 'vN'` in `app.js` must match — a test enforces it. The
root service worker caches by URL, so without a bump an old cache can serve
stale JS and the page will misbehave in ways no test reproduces.

## Testing — read this before adding a feature

There are two layers, and they catch different things.

**Stubbed (fast):** `v2-data`, `v2-render`, `v2-shell`, `v2-sweep`. These
stub `fetch` and hand modules a jsdom document. Good for logic, escaping,
view models, and clicking every control at four widths.

**HTTP (real):** `v2-http-smoke.test.js`. Boots the real server on a random
port with a throwaway database, logs in for real, seeds through the real
sync endpoint, fetches the page over HTTP, and awaits **only the app's own
boot promise** (`window.__V2__.ready`). ~3s for the file.

Three shipped bugs were invisible to the stubbed layer alone:

1. `/v2` served its index in place instead of redirecting, so relative URLs
   resolved one level too high — no CSS loaded, and `/app.js` pulled in the
   *main* app's script. Nothing stubbed ever resolves a URL.
2. v2 sent `credentials: 'same-origin'` while this app uses
   `Authorization: Bearer` from `localStorage`. Everything 401'd. No test
   ever authenticated.
3. `app.js` never called `render()`. The page could not start. The suite
   passed because the test helper called `render()` itself — **the harness
   was performing the app's boot.**

So: **when a feature touches a URL, auth, or startup, add a case to
`v2-http-smoke.test.js`.** A stubbed test alone cannot see those.

`tests/helpers/v2-server.js` gives you `startServer()` → `{ base, token,
seed, request, stop }` and a realistic `patient(n, overrides)` factory.

Never satisfy the "app.js boots itself" test by calling `render()` from a
test. That test exists precisely to catch the harness doing the app's job.

## Known scope boundaries (not defects)

- Online-only: no IndexedDB, no offline queue. A dropped connection shows a
  retry state.
- Radiographs are drawn SVG placeholders; server-side thumbnails are an
  outstanding prerequisite (design spec §8.1).
- `expectedDischargeDate` does not exist in the schema, so the POD track
  ends at the last milestone rather than a discharge station.
- Admin links out to `/` rather than being reimplemented.
- Image upload, AI features, bulk operations and templates are out of
  scope; their palette entries toast "not in the preview build".
