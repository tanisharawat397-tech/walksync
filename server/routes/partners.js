"use strict";
const express = require("express");
const db = require("../db");
const auth = require("../auth");
const { clean, GENDERS, TIMES } = require("../validate");

const router = express.Router();

const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function publicPartner(u) {
  return {
    id: u.id, name: u.name, gender: u.gender, location: u.location, time: u.time,
    pace: u.pace, bio: u.bio, rating: u.rating, walks: u.walks || 0,
    memberSince: u.createdAt,
  };
}

/** GET /api/partners?location=&gender=&time=&saved=1 */
router.get("/partners", auth.optional, (req, res) => {
  const location = norm(req.query.location);
  const gender = norm(req.query.gender || "all");
  const time = norm(req.query.time || "all");
  const savedOnly = req.query.saved === "1";

  const saved = new Set(
    db.favorites.filter(f => f.userId === req.userId).map(f => f.partnerId)
  );
  if (savedOnly && !req.userId) return res.status(401).json({ error: "Log in to see saved partners." });

  const list = db.users
    .filter(u => u.available && u.id !== req.userId)
    .filter(u => !location || norm(u.location).includes(location))
    .filter(u => gender === "all" || !GENDERS.includes(gender) || u.gender === gender)
    // "both" walkers match either morning or evening searches
    .filter(u => time === "all" || !TIMES.includes(time) || u.time === time || u.time === "both")
    .filter(u => !savedOnly || saved.has(u.id))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .map(u => ({ ...publicPartner(u), saved: saved.has(u.id) }));

  res.json({ partners: list, count: list.length });
});

router.get("/locations", (_req, res) => {
  const counts = {};
  for (const u of db.users) if (u.available) counts[u.location] = (counts[u.location] || 0) + 1;
  const locations = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, partners]) => ({ name, partners }));
  res.json({ locations });
});

router.get("/stats", (_req, res) => {
  res.json({
    partners: db.users.filter(u => u.available).length,
    localities: new Set(db.users.map(u => norm(u.location))).size,
    requests: db.requests.length,
  });
});

router.post("/favorites/:partnerId", auth.required, (req, res) => {
  const partner = db.users.find(u => u.id === req.params.partnerId);
  if (!partner || partner.id === req.userId) return res.status(404).json({ error: "Partner not found." });
  const idx = db.favorites.findIndex(f => f.userId === req.userId && f.partnerId === partner.id);
  let saved;
  if (idx >= 0) { db.favorites.splice(idx, 1); saved = false; }
  else { db.favorites.push({ userId: req.userId, partnerId: partner.id, createdAt: db.now() }); saved = true; }
  db.save();
  res.json({ saved });
});

/** Simple contact-form endpoint. */
router.post("/contact", (req, res) => {
  const name = clean(req.body.name, 60);
  const email = clean(req.body.email, 254);
  const message = clean(req.body.message, 1000);
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || message.length < 10) {
    return res.status(400).json({ error: "Please enter your name, a valid email and a message of at least 10 characters." });
  }
  db.contacts.push({ id: db.id(), name, email, message, createdAt: db.now() });
  db.save();
  res.status(201).json({ ok: true });
});

module.exports = router;
