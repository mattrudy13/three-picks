// Pure helpers for Three Picks: read ESPN's scoreboard, pick random sides, format the slip.
// No DOM or network here, so `node --test` can check them.

export const TZ = "America/New_York";
export const ESPN_BOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

// groups=50 is all of Division I; limit=400 so a busy Saturday isn't cut off.
export function boardUrl(ymd) {
  return `${ESPN_BOARD}?dates=${ymd.replaceAll("-", "")}&groups=50&limit=400`;
}

// Today's date in Eastern time as YYYY-MM-DD (the en-CA locale formats dates that way).
export function etDate(when = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(when);
}

export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Games ESPN still lists as "pre" but that won't be played as scheduled.
const SKIP_STATUS = new Set(["STATUS_POSTPONED", "STATUS_CANCELED", "STATUS_SUSPENDED", "STATUS_DELAYED"]);

// The home team's spread (negative = home favored), or null when there's no usable line.
// `spread` is from the home side, but the favorite flags are checked first because they're explicit.
export function homeLine(odds) {
  if (odds?.spread === undefined || odds?.spread === null) return null;
  const raw = Number(odds.spread);
  if (!Number.isFinite(raw)) return null;
  const size = Math.abs(raw);
  if (size === 0) return 0;
  if (odds.homeTeamOdds?.favorite) return -size;
  if (odds.awayTeamOdds?.favorite) return size;
  return raw;
}

function teamName(team) {
  return team?.location || team?.shortDisplayName || team?.displayName || "TBD";
}

// Every game on the board that hasn't tipped yet and has a spread.
export function candidates(events, now = Date.now()) {
  return events.flatMap((e) => {
    const c = e.competitions?.[0];
    if (!c) return [];
    const status = c.status?.type ?? {};
    if (status.state !== "pre" || SKIP_STATUS.has(status.name)) return [];
    if (!(Date.parse(e.date) > now)) return [];
    const odds = (c.odds ?? []).find((o) => homeLine(o) !== null);
    if (!odds) return [];
    const home = c.competitors?.find((t) => t.homeAway === "home");
    const away = c.competitors?.find((t) => t.homeAway === "away");
    if (!home || !away) return [];
    return [{
      id: String(e.id),
      start: e.date,
      tv: c.broadcasts?.[0]?.names?.[0] ?? "",
      home: teamName(home.team),
      away: teamName(away.team),
      homeLine: homeLine(odds),
      neutral: Boolean(c.neutralSite),
    }];
  });
}

// One side of a game as a slip leg.
export function toPick(game, side) {
  const isHome = side === "home";
  const line = isHome ? game.homeLine : -game.homeLine;
  return {
    id: game.id,
    team: isHome ? game.home : game.away,
    opp: isHome ? game.away : game.home,
    where: isHome || game.neutral ? "vs" : "at",
    line: line === 0 ? 0 : line, // avoid -0
    start: game.start,
    tv: game.tv,
  };
}

// n different games, each with a coin-flip side. A partial Fisher-Yates shuffle gives every game the
// same chance of being drawn.
export function drawPicks(pool, rng = Math.random, n = 3) {
  const games = pool.slice();
  const out = [];
  for (let i = 0; i < Math.min(n, games.length); i++) {
    const j = i + Math.floor(rng() * (games.length - i));
    [games[i], games[j]] = [games[j], games[i]];
    out.push(toPick(games[i], rng() < 0.5 ? "home" : "away"));
  }
  return out;
}

// What the shared store holds is written by any visitor's browser, so check its shape before using it.
export function isValidCurrent(cur) {
  return Boolean(
    cur && typeof cur.slate === "string" && typeof cur.rollId === "string" &&
    Array.isArray(cur.picks) && cur.picks.length === 3 &&
    cur.picks.every((p) => p && typeof p.team === "string" && typeof p.opp === "string" &&
      typeof p.line === "number" && typeof p.start === "string"),
  );
}

// New picks are rolled automatically when nothing valid is stored or the stored slate is from a past day.
export function isStale(cur, today) {
  return !isValidCurrent(cur) || cur.slate < today;
}

export function lineText(line) {
  if (line === 0) return "PK";
  return `${line > 0 ? "+" : "−"}${Math.abs(line)}`;
}

// "FRI · NOV 13"
export function slipDate(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const fmt = (opts) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(d).toUpperCase();
  return `${fmt({ weekday: "short" })} · ${fmt({ month: "short" })} ${d.getUTCDate()}`;
}

// "6:00 PM" in Eastern time.
export function clockTime(when) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    .format(new Date(when));
}

// "at Clemson · 6:00 PM · ESPNU"; a game that has started says TIPPED instead of its time.
export function legMeta(pick, now = Date.now()) {
  const when = Date.parse(pick.start) <= now ? "TIPPED" : clockTime(pick.start);
  return [`${pick.where === "vs" ? "vs" : "at"} ${pick.opp}`, when, pick.tv].filter(Boolean).join(" · ");
}

export function newRollId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
