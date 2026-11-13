# Three Picks

One page: three random men's college basketball spread picks from today's games, printed on a receipt slip.
NEW PICKS crumples the slip, tosses it off the right edge, and a receipt printer prints a new one. No method or
reasoning on purpose. Personal use (Rudy and friends). Static site, no build step, GitHub Pages.

## Files

- `index.html`, `style.css`: the printer, the slip, the crumpled-ball SVG.
- `app.js`: ESPN fetch (with a 10-minute board cache), roll logic, store sync, animations (Web Animations API).
- `lib.js`: pure helpers (ESPN parsing, random draw, formatting, staleness). Tested by `npm test`.
- `store.js`: the shared slip. Firebase Realtime Database when `firebase-config.js` is set, else a local
  stand-in (localStorage + BroadcastChannel) that only syncs tabs on one device.
- `database.rules.json`: Realtime Database rules, pasted into the Firebase console by hand (not deployed by CLI).
- Dev server: `npm run serve` (port 8770), or `.claude/launch.json`.

## Rules (Rudy's picks, 2026-11-13)

- **Pool:** every D-I game (`groups=50`) that is still "pre", hasn't passed its start time, and has a DraftKings
  spread on ESPN's scoreboard. Postponed/canceled/delayed games are skipped.
- **Draw:** 3 different games, each side a coin flip (partial Fisher-Yates). Neutral-site games say "vs".
- **Late night:** once fewer than 3 games are left today, the roll uses tomorrow's slate (the slip shows that date).
- **Shared:** one slip for everyone. Anyone's tap rerolls it for every open page (pages crumple and reprint).
  No reroll limit; the slip shows "ROLLED 6:42 PM" (Eastern).
- **Daily:** the first visit of a new Eastern day (stored slate older than today) rolls automatically, through a
  transaction so two simultaneous visitors can't write different slips. A tipped pick stays on the slip and
  reads TIPPED instead of its time.
- **Look:** mockup A "bet slip" on green felt (Oswald + IBM Plex Mono) plus Rudy's motion idea. Mockups and
  the motion demo: https://claude.ai/artifact/AqaLtwoZo5MoZsSdGPecSV
- **Motion:** crumple 450 ms; the ball fades in during it and arcs off the right edge as one 1.05 s animation
  (Rudy: v1 had a stall between them). Print feeds ~42%, stalls 600 ms with the LED on, then feeds the rest
  (Rudy: "like a real printer", not one smooth motion), linear speed. `prefers-reduced-motion` gets fades.

## Data notes

- Scoreboard: `site.api.espn.com/.../mens-college-basketball/scoreboard?dates=YYYYMMDD&groups=50&limit=400`,
  ~1 MB, CORS `*`. Only fetched when rolling (viewers just read the store).
- `odds[0].spread` is the home team's line; `homeTeamOdds.favorite` / `awayTeamOdds.favorite` are checked first.
- Firebase node `current`: `{ slate, picks[3]{id, team, opp, where, line, start, tv}, poolSize, rollId, rolledAt }`.
  `rollId` changes every roll; that's what tells open pages to animate. `rolledAt` is a server timestamp.
- Only `databaseURL` goes in `firebase-config.js` (no API key in the repo). The rules check shape and size only;
  anyone with the URL could write a fake slip. Accepted for a friends-only toy.

## Versions

- **v0.1** (2026-11-13): first build.
