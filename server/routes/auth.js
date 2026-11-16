"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const auth = require("../auth");
const { clean, EMAIL_RE, validateProfile } = require("../validate");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});

/** Fields safe to send to the browser for the signed-in user. */
function me(u) {
  return {
    id: u.id, name: u.name, email: u.email, gender: u.gender, location: u.location,
    time: u.time, pace: u.pace, bio: u.bio, available: u.available,
  };
}

router.post("/register", limiter, async (req, res, next) => {
  try {
    const email = clean(req.body.email, 254).toLowerCase();
    const password = String(req.body.password ?? "");
    const { out, errors } = validateProfile(req.body);
    if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";
    if (password.length < 8 || password.length > 72) errors.password = "Password must be 8-72 characters.";
    if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
    if (db.users.some(u => u.email === email)) {
      return res.status(409).json({ error: "An account with this email already exists.", fields: { email: "Email already registered." } });
    }
    const user = {
      id: db.id(), email, passwordHash: await bcrypt.hash(password, 10),
      ...out, available: true, rating: null, walks: 0, demo: false, createdAt: db.now(),
    };
    db.users.push(user);
    db.save();
    auth.issue(res, user);
    res.status(201).json({ user: me(user) });
  } catch (e) { next(e); }
});

router.post("/login", limiter, async (req, res, next) => {
  try {
    const email = clean(req.body.email, 254).toLowerCase();
    const password = String(req.body.password ?? "");
    const user = db.users.find(u => u.email === email && u.passwordHash);
    // Compare even when the user is missing to keep timing similar.
    const hash = user?.passwordHash || "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi";
    const ok = await bcrypt.compare(password, hash);
    if (!user || !ok) return res.status(401).json({ error: "Incorrect email or password." });
    auth.issue(res, user);
    res.json({ user: me(user) });
  } catch (e) { next(e); }
});

router.post("/logout", (_req, res) => {
  auth.clear(res);
  res.json({ ok: true });
});

router.get("/me", auth.optional, (req, res) => {
  const user = req.userId && db.users.find(u => u.id === req.userId);
  res.json({ user: user ? me(user) : null });
});

router.patch("/me", auth.required, (req, res) => {
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(401).json({ error: "Please log in again." });
  const { out, errors } = validateProfile(req.body, { partial: true });
  if (typeof req.body.available === "boolean") out.available = req.body.available;
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please fix the highlighted fields.", fields: errors });
  Object.assign(user, out);
  db.save();
  res.json({ user: me(user) });
});

module.exports = router;
