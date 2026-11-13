// The shared "current slip" everyone sees. Firebase Realtime Database when firebase-config.js is filled in;
// otherwise a local stand-in that only syncs tabs on one device (for building and testing).
//
// The store holds one node, `current`: { slate, picks[3], poolSize, rollId, rolledAt }.
// rollId changes on every roll, which is how open pages know to crumple and reprint.

import { firebaseConfig } from "./firebase-config.js";
import { isStale } from "./lib.js";

const SDK = "https://www.gstatic.com/firebasejs/11.0.2";

export async function openStore() {
  return firebaseConfig ? firebaseStore(firebaseConfig) : localStore();
}

async function firebaseStore(config) {
  const [{ initializeApp }, db] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-database.js`),
  ]);
  const ref = db.ref(db.getDatabase(initializeApp(config)), "current");
  const stamp = (roll) => ({ ...roll, rolledAt: db.serverTimestamp() });
  return {
    mode: "firebase",
    subscribe: (cb) => db.onValue(ref, (snap) => cb(snap.val())),
    reroll: (roll) => db.set(ref, stamp(roll)),
    // The day's first visitor rolls. A transaction, so two people opening the page at the same moment
    // can't each write a different slip: the second one sees the first one's slip isn't stale and backs off.
    claimDaily: (roll, today) => db.runTransaction(ref, (cur) => (isStale(cur, today) ? stamp(roll) : undefined)),
  };
}

function localStore() {
  const KEY = "three-picks:current";
  const channel = "BroadcastChannel" in globalThis ? new BroadcastChannel("three-picks") : null;
  const listeners = [];
  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
  };
  const write = (value) => {
    try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode: tabs still sync */ }
    listeners.forEach((cb) => cb(value));
    channel?.postMessage(value);
  };
  channel?.addEventListener("message", (e) => listeners.forEach((cb) => cb(e.data)));
  const stamp = (roll) => ({ ...roll, rolledAt: Date.now() });
  return {
    mode: "local",
    subscribe(cb) {
      listeners.push(cb);
      queueMicrotask(() => cb(read()));
    },
    async reroll(roll) { write(stamp(roll)); },
    async claimDaily(roll, today) { if (isStale(read(), today)) write(stamp(roll)); },
  };
}
