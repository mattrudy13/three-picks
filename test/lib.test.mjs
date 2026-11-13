import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, boardUrl, candidates, drawPicks, etDate, homeLine, isStale, isValidCurrent,
  legMeta, lineText, slipDate, toPick,
} from "../lib.js";

// Trimmed ESPN scoreboard event: only the fields lib.js reads.
function event({ id = "1", date = "2026-11-13T23:00Z", state = "pre", name = "STATUS_SCHEDULED",
  odds = { spread: -4.5, homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } },
  home = "Clemson", away = "Georgetown", tv = "ESPNU", neutral = false } = {}) {
  return {
    id, date,
    competitions: [{
      status: { type: { state, name } },
      odds: odds ? [odds] : undefined,
      neutralSite: neutral,
      broadcasts: tv ? [{ names: [tv] }] : [],
      competitors: [
        { homeAway: "home", team: { location: home } },
        { homeAway: "away", team: { location: away } },
      ],
    }],
  };
}

const NOW = Date.parse("2026-11-13T21:00Z"); // 4 PM ET, before every fixture game

test("homeLine reads the home side and trusts the favorite flags", () => {
  assert.equal(homeLine({ spread: -4.5, homeTeamOdds: { favorite: true } }), -4.5);
  // Away favorite (ESPN "WRST -1.5" with spread 1.5)
  assert.equal(homeLine({ spread: 1.5, awayTeamOdds: { favorite: true } }), 1.5);
  // Flags win over a sign that disagrees
  assert.equal(homeLine({ spread: 3, homeTeamOdds: { favorite: true } }), -3);
  assert.equal(homeLine({ spread: 0 }), 0);
  assert.equal(homeLine({ spread: null }), null);
  assert.equal(homeLine({ details: "OFF" }), null);
  assert.equal(homeLine(undefined), null);
});

test("candidates keeps only untipped games with a line", () => {
  const events = [
    event({ id: "a" }),
    event({ id: "b", state: "in" }),
    event({ id: "c", state: "post" }),
    event({ id: "d", odds: null }),
    event({ id: "e", odds: { spread: null } }),
    event({ id: "f", name: "STATUS_POSTPONED" }),
    event({ id: "g", date: "2026-11-13T20:00Z" }), // "pre" but already past its start time
  ];
  const pool = candidates(events, NOW);
  assert.deepEqual(pool.map((g) => g.id), ["a"]);
  assert.deepEqual(pool[0], {
    id: "a", start: "2026-11-13T23:00Z", tv: "ESPNU", home: "Clemson", away: "Georgetown",
    homeLine: -4.5, neutral: false,
  });
});

test("toPick flips the line for the away side and words the opponent", () => {
  const game = candidates([event()], NOW)[0];
  assert.deepEqual(toPick(game, "away"), {
    id: "1", team: "Georgetown", opp: "Clemson", where: "at", line: 4.5, start: "2026-11-13T23:00Z", tv: "ESPNU",
  });
  assert.equal(toPick(game, "home").line, -4.5);
  assert.equal(toPick(game, "home").where, "vs");
  const neutral = candidates([event({ neutral: true })], NOW)[0];
  assert.equal(toPick(neutral, "away").where, "vs");
  const pickem = candidates([event({ odds: { spread: 0 } })], NOW)[0];
  assert.ok(Object.is(toPick(pickem, "away").line, 0)); // not -0
});

test("drawPicks returns 3 different games", () => {
  const pool = candidates(Array.from({ length: 10 }, (_, i) => event({ id: String(i) })), NOW);
  for (let run = 0; run < 50; run++) {
    const picks = drawPicks(pool);
    assert.equal(picks.length, 3);
    assert.equal(new Set(picks.map((p) => p.id)).size, 3);
  }
  // A fixed rng makes the draw predictable: always the first remaining game, always the away side.
  const picks = drawPicks(pool, () => 0.99);
  assert.ok(picks.every((p) => p.team === "Georgetown"));
});

test("drawPicks covers every game and both sides over many rolls", () => {
  const pool = candidates(Array.from({ length: 5 }, (_, i) => event({ id: String(i) })), NOW);
  const seen = new Set();
  const sides = new Set();
  for (let run = 0; run < 500; run++) {
    for (const p of drawPicks(pool)) { seen.add(p.id); sides.add(p.where); }
  }
  assert.equal(seen.size, 5);
  assert.deepEqual([...sides].sort(), ["at", "vs"]);
});

test("isValidCurrent and isStale guard what's in the shared store", () => {
  const picks = drawPicks(candidates([event({ id: "1" }), event({ id: "2" }), event({ id: "3" })], NOW));
  const cur = { slate: "2026-11-13", rollId: "x", poolSize: 3, picks, rolledAt: NOW };
  assert.ok(isValidCurrent(cur));
  assert.ok(!isValidCurrent(null));
  assert.ok(!isValidCurrent({ ...cur, picks: picks.slice(0, 2) }));
  assert.ok(!isValidCurrent({ ...cur, picks: [...picks.slice(0, 2), { team: 5 }] }));
  assert.ok(!isStale(cur, "2026-11-13"));
  assert.ok(!isStale({ ...cur, slate: "2026-11-14" }, "2026-11-13")); // tonight's roll of tomorrow's games
  assert.ok(isStale(cur, "2026-11-14"));
  assert.ok(isStale(null, "2026-11-14"));
});

test("formatting", () => {
  assert.equal(lineText(4.5), "+4.5");
  assert.equal(lineText(-17.5), "−17.5");
  assert.equal(lineText(0), "PK");
  assert.equal(slipDate("2026-11-13"), "FRI · NOV 13");
  assert.equal(slipDate("2026-12-01"), "TUE · DEC 1");
  const pick = { where: "at", opp: "Clemson", start: "2026-11-13T23:00Z", tv: "ESPNU" };
  assert.equal(legMeta(pick, NOW), "at Clemson · 6:00 PM · ESPNU");
  assert.equal(legMeta({ ...pick, tv: "" }, NOW), "at Clemson · 6:00 PM");
  assert.equal(legMeta(pick, Date.parse("2026-11-13T23:30Z")), "at Clemson · TIPPED · ESPNU");
});

test("dates are Eastern", () => {
  // 11:30 PM ET on Nov 13 is already Nov 14 in UTC.
  assert.equal(etDate(new Date("2026-11-14T04:30Z")), "2026-11-13");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(boardUrl("2026-11-13"), "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=20261113&groups=50&limit=400");
});
