// Page wiring: fetch ESPN's board when a roll is needed, keep the slip in step with the shared store,
// and run the printer animations (crumple → toss → print, pause, print).

import {
  addDays, boardUrl, candidates, clockTime, drawPicks, etDate, isStale, isValidCurrent,
  legMeta, lineText, newRollId, slipDate,
} from "./lib.js";
import { openStore } from "./store.js";

const $ = (id) => document.getElementById(id);
const slip = $("slip");
const printer = $("printer");
const ball = $("ball");
const button = $("reroll");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

let latest = null;    // newest valid slip from the store
let shownId = null;   // rollId of the slip on screen
let slipOut = false;  // the slip is fully printed and visible
let busy = false;     // an animation or a local reroll is running
let note = "";        // message to print on the next slip (e.g. a failed reroll)
let autoTried = false;

class NoGames extends Error {}

function setBusy(value) {
  busy = value;
  button.disabled = value;
}

function setStatus(text) {
  $("status").textContent = text;
}

function messageFor(err) {
  return err instanceof NoGames
    ? "No games with lines today or tomorrow."
    : "Couldn't reach ESPN. Try again in a minute.";
}

// ---------- picks ----------

// ESPN's full D-I board is ~1 MB, slow enough on a phone to leave the printer empty after a tap. Boards are
// kept for 10 minutes (and today's is fetched in the background after each print), so a reroll usually
// waits only on the animation. A line that moved half a point in that time doesn't matter for random picks,
// and tipped games are still dropped at roll time because candidates() checks the clock then.
const BOARD_TTL = 10 * 60 * 1000;
const boards = new Map(); // ymd -> { at, events: Promise }

function loadBoard(ymd) {
  const hit = boards.get(ymd);
  if (hit && Date.now() - hit.at < BOARD_TTL) return hit.events;
  const events = fetch(boardUrl(ymd), { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`ESPN ${res.status}`);
      return res.json();
    })
    .then((data) => data.events ?? []);
  events.catch(() => boards.delete(ymd)); // don't keep a failed fetch around
  boards.set(ymd, { at: Date.now(), events });
  return events;
}

async function fetchPool(ymd) {
  return candidates(await loadBoard(ymd));
}

// Today's games that haven't tipped; once fewer than 3 are left, tomorrow's slate instead.
async function buildRoll() {
  let slate = etDate();
  let pool = await fetchPool(slate);
  if (pool.length < 3) {
    slate = addDays(slate, 1);
    pool = await fetchPool(slate);
  }
  if (pool.length < 3) throw new NoGames();
  return { slate, picks: drawPicks(pool), poolSize: pool.length, rollId: newRollId() };
}

// A write that never reaches the server (offline) shouldn't leave the printer empty forever.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// ---------- slip ----------

function legItem(pick, i) {
  const li = document.createElement("li");
  li.className = "leg";
  li.innerHTML = '<span class="num"></span><div><p class="pick"><span class="team"></span> '
    + '<span class="line"></span></p><p class="meta"></p></div>';
  li.querySelector(".num").textContent = String(i + 1).padStart(2, "0");
  li.querySelector(".team").textContent = pick.team;
  li.querySelector(".line").textContent = lineText(pick.line);
  // Each piece ("at Clemson", "6:00 PM", "SEC Network") wraps as a unit instead of breaking mid-name.
  const meta = li.querySelector(".meta");
  legMeta(pick).split(" · ").forEach((part, i) => {
    if (i) meta.append(" · ");
    const span = document.createElement("span");
    span.className = "nowrap";
    span.textContent = part;
    meta.append(span);
  });
  return li;
}

function render(cur) {
  $("slip-date").textContent = slipDate(cur.slate);
  $("legs").replaceChildren(...cur.picks.map(legItem));
  $("rolled").textContent = typeof cur.rolledAt === "number" ? `ROLLED ${clockTime(cur.rolledAt)}` : "";
  $("pool").textContent = `${cur.poolSize} GAMES ON THE BOARD`;
  const msg = $("msg");
  msg.textContent = note;
  msg.hidden = !note;
  note = "";
  $("announce").textContent = `Picks: ${cur.picks.map((p) => `${p.team} ${lineText(p.line)}`).join(", ")}`;
}

// ---------- animation ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const play = (el, frames, opts) => el.animate(frames, { fill: "forwards", ...opts });

// Keep the end state as an inline style and drop the finished animations.
function settle(el, transform) {
  if (transform !== undefined) el.style.transform = transform;
  el.getAnimations().forEach((a) => a.cancel());
}

const CRUMPLE = [
  { offset: 0, transform: "none", filter: "none", opacity: 1 },
  { offset: 0.35, transform: "scale(.92,.72) rotate(-3deg) skewX(4deg)", filter: "brightness(.96)", opacity: 1 },
  { offset: 0.7, transform: "scale(.45,.35) rotate(12deg) skewY(-8deg)", filter: "brightness(.9)", opacity: 1 },
  { offset: 1, transform: "scale(.1) rotate(-25deg)", filter: "brightness(.85)", opacity: 0 },
];

// The ball fades in while the slip crumples, then arcs up and out the right edge in one motion
// (crumple and flight are one animation so there's no stall between them). dx = distance to off-screen.
function tossFrames(dx) {
  const frames = [
    { offset: 0, opacity: 0, transform: "translate(0px, 0px) scale(1.8) rotate(-20deg)" },
    { offset: 0.3, opacity: 0, transform: "translate(0px, 0px) scale(1.5) rotate(-10deg)" },
  ];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -660 * t + 600 * t * t; // peaks ~180px up, ends 60px above the start
    frames.push({
      offset: i === steps ? 1 : 0.43 + 0.57 * t,
      opacity: 1,
      transform: `translate(${dx * t}px, ${y}px) scale(1) rotate(${500 * t}deg)`,
    });
  }
  return frames;
}

async function discard() {
  slipOut = false;
  if (reduceMotion.matches) {
    await play(slip, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).finished;
    slip.style.transform = "translateY(-100%)";
    settle(slip);
    return;
  }
  const box = slip.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height * 0.45; // the slip's transform-origin
  ball.style.left = `${cx - 36}px`;
  ball.style.top = `${cy - 32}px`;
  const crumple = play(slip, CRUMPLE, { duration: 450, easing: "cubic-bezier(.5,0,.75,0)" });
  const toss = play(ball, tossFrames(innerWidth - cx + 100), { duration: 1050 });
  await toss.finished;
  slip.style.transform = "translateY(-100%)";
  crumple.cancel();
  toss.cancel();
}

// Feed part of the slip, stall, then feed the rest, like a real receipt printer.
async function print() {
  if (reduceMotion.matches) {
    slip.style.transform = "none";
    await play(slip, [{ opacity: 0 }, { opacity: 1 }], { duration: 250 }).finished;
    settle(slip);
    slipOut = true;
    return;
  }
  printer.classList.add("printing");
  await play(slip, [{ transform: "translateY(-100%)" }, { transform: "translateY(-58%)" }], { duration: 800 }).finished;
  printer.classList.replace("printing", "paused");
  await sleep(600);
  printer.classList.replace("paused", "printing");
  await play(slip, [{ transform: "translateY(-58%)" }, { transform: "none" }], { duration: 1000 }).finished;
  printer.classList.remove("printing");
  settle(slip, "none");
  slipOut = true;
}

// Bring the screen up to the newest slip. If another roll lands mid-animation, the loop picks it up next.
async function sync() {
  if (busy) return;
  setBusy(true);
  try {
    while (latest && latest.rollId !== shownId) {
      const next = latest;
      if (slipOut) await discard();
      render(next);
      shownId = next.rollId;
      await print();
    }
  } finally {
    setBusy(false);
  }
  loadBoard(etDate()).catch(() => {}); // warm the board for the next tap
}

// ---------- events ----------

async function autoRoll(old) {
  if (autoTried) return;
  autoTried = true;
  if (!old) setStatus("Loading today's games…");
  try {
    await withTimeout(store.claimDaily(await buildRoll(), etDate()), 10000);
    setStatus("");
  } catch (err) {
    if (old) {
      // Keep showing the last slip rather than an empty printer.
      note = messageFor(err);
      latest = old;
      setStatus("");
      sync();
    } else {
      setStatus(messageFor(err));
    }
  }
}

button.addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);
  // Start throwing the old slip away right away so the tap feels instant; ESPN loads meanwhile.
  const gone = slipOut ? discard() : Promise.resolve();
  try {
    await withTimeout(store.reroll(await buildRoll()), 10000);
  } catch (err) {
    note = err.message === "timeout" ? "Couldn't save the new picks. Try again." : messageFor(err);
    shownId = null; // reprint the slip we had, with the message on it
  }
  await gone;
  setBusy(false);
  sync();
});

// A page left open overnight rolls the new day's slip when it's looked at again.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && latest && isStale(latest, etDate())) {
    autoTried = false;
    autoRoll(latest);
  }
});

const store = await openStore();
if (store.mode === "local") {
  $("mode").hidden = false;
  $("mode").textContent = "Test mode: picks only sync between tabs on this device.";
}

store.subscribe((cur) => {
  if (isValidCurrent(cur) && !isStale(cur, etDate())) {
    latest = cur;
    sync();
  } else {
    autoRoll(isValidCurrent(cur) ? cur : null);
  }
});
