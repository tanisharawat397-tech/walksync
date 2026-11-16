/**
 * Tiny JSON-file datastore. Node is single-threaded and all operations here are
 * synchronous, so there are no write races. Writes are atomic (temp file + rename).
 * For heavy traffic, swap this module for PostgreSQL/MongoDB - routes only use
 * load(), save() and id().
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.resolve(process.env.DB_FILE || path.join(__dirname, "..", "data", "db.json"));
const empty = () => ({ users: [], requests: [], saved: [], messages: [] });

let data = null;

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    data = empty();
  }
  for (const [key, value] of Object.entries(empty())) if (!Array.isArray(data[key])) data[key] = value;
  return data;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2));
  fs.renameSync(tmp, FILE);
}

function reset() {
  data = empty();
  save();
}

const id = () => crypto.randomUUID();

module.exports = { load, save, reset, id, FILE };
