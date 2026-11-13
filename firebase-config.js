// Firebase Realtime Database connection. Leave as null to run in local test mode (tabs on one device).
//
// Only the database URL is needed: the page talks to the Realtime Database and nothing else, so no API key
// goes in the repo. database.rules.json (pasted into the Firebase console) is what limits what can be written.
//
export const firebaseConfig = {
  databaseURL: "https://three-picks-default-rtdb.europe-west1.firebasedatabase.app",
};
