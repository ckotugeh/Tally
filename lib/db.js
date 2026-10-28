// Plain JSON-file data store. Deliberately synchronous (fs.*Sync) so that
// a read-modify-write sequence within one request can never be interleaved
// by another request on Node's single thread — that keeps id assignment
// and file writes race-free without needing a real database or locks.
//
// This is fine for the scale of an observer team or a constituency office.
// For a large multi-user deployment, swap this module for a real database
// (Postgres/SQLite) — the rest of the app only calls the functions
// exported below, so that swap doesn't touch server.js or the frontend.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

fs.mkdirSync(DATA_DIR, { recursive: true });

function filePath(name) {
  return path.join(DATA_DIR, name);
}

function readJSON(name, fallback) {
  const fp = filePath(name);
  if (!fs.existsSync(fp)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(name, data) {
  const fp = filePath(name);
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, fp); // atomic on the same filesystem
}

let stations = readJSON('stations.json', []);
let consts = readJSON('consts.json', []);
let national = readJSON('national.json', { votes: [] });
let candidates = readJSON('candidates.json', ['Candidate A', 'Candidate B']);
let seq = readJSON('seq.json', { next: 1 });

function nextId() {
  const id = seq.next++;
  writeJSON('seq.json', seq);
  return id;
}

// Stations (Form 34A) — create-only. There is intentionally no "update
// station" function: the only way to change a station's votes is to
// create a brand new record via a fresh upload. reconcile.js is what
// notices and flags two records for the same station code disagreeing.
function commitStation(fields) {
  const record = Object.assign({ id: nextId() }, fields);
  stations.push(record);
  writeJSON('stations.json', stations);
  return record;
}
function listStations() {
  return stations;
}
function removeStation(id) {
  id = Number(id);
  const idx = stations.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  const [removed] = stations.splice(idx, 1);
  writeJSON('stations.json', stations);
  return removed;
}
function replaceAllStations(list) {
  stations = list;
  writeJSON('stations.json', stations);
}

// Constituencies (Form 34B) — the officially declared totals being
// checked, so unlike stations these are just plain editable records.
function upsertConst(fields) {
  if (fields.id) {
    const c = consts.find((c) => c.id === Number(fields.id));
    if (c) {
      c.name = fields.name;
      c.votes = fields.votes;
      writeJSON('consts.json', consts);
      return c;
    }
  }
  const record = { id: nextId(), name: fields.name, votes: fields.votes };
  consts.push(record);
  writeJSON('consts.json', consts);
  return record;
}
function listConsts() {
  return consts;
}
function removeConst(id) {
  id = Number(id);
  const idx = consts.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const [removed] = consts.splice(idx, 1);
  writeJSON('consts.json', consts);
  return removed;
}
function replaceAllConsts(list) {
  consts = list;
  writeJSON('consts.json', consts);
}

function getNational() {
  return national;
}
function setNational(votes) {
  national = { votes };
  writeJSON('national.json', national);
  return national;
}

function getCandidates() {
  return candidates;
}
function setCandidates(list) {
  candidates = list;
  writeJSON('candidates.json', candidates);
  return candidates;
}

// A fresh read of the data files exactly as they are on disk right now, bypassing the
// copies held in memory. integrity.js compares this against the audit log, which is how
// an edit made directly to a data file (instead of through the app) gets noticed.
// A file that exists but cannot be parsed is reported, not silently treated as empty.
function snapshotFromDisk() {
  const unreadable = [];
  function strict(name, fallback) {
    const fp = filePath(name);
    if (!fs.existsSync(fp)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {
      unreadable.push(name);
      return fallback;
    }
  }
  const snap = {
    stations: strict('stations.json', []),
    consts: strict('consts.json', []),
    national: strict('national.json', { votes: [] }),
    candidates: strict('candidates.json', ['Candidate A', 'Candidate B']),
  };
  snap.unreadable = unreadable;
  return snap;
}

module.exports = {
  snapshotFromDisk,
  commitStation,
  listStations,
  removeStation,
  replaceAllStations,
  upsertConst,
  listConsts,
  removeConst,
  replaceAllConsts,
  getNational,
  setNational,
  getCandidates,
  setCandidates,
};
