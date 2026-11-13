# Three Picks

Three random college basketball spread picks from today's games, printed on a receipt. Hit **New picks** and
the slip gets crumpled, tossed, and reprinted, for everyone who has the page open. No method, no reasoning.

Lines are DraftKings spreads from ESPN's public scoreboard. Just for fun.

## Run locally

```bash
npm run serve   # http://localhost:8770
npm test
```

Without `firebase-config.js` filled in, the page runs in test mode: picks sync between tabs on one device only.

## Firebase setup (one time)

1. In the [Firebase console](https://console.firebase.google.com), create a project (Analytics off).
2. Build → Realtime Database → Create database → start in locked mode.
3. Rules tab: paste `database.rules.json` and publish.
4. Copy the database URL into `firebase-config.js`.
