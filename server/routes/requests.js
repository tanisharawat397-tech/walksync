"use strict";
const express = require("express");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const auth = require("../auth");
const { clean } = require("../validate");

const router = express.Router();
router.use(auth.required);

const sendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => req.userId,
  message: { error: "You've sent a lot of requests. Please try again later." },
});

const nameOf = id => db.users.find(u => u.id === id)?.name || "Unknown";

function view(r) {
  return {
    id: r.id, status: r.status, message: r.message, createdAt: r.createdAt,
    from: { id: r.fromId, name: nameOf(r.fromId) },
    to: { id: r.toId, name: nameOf(r.toId) },
  };
}

/** GET /api/requests -> { incoming, outgoing } */
router.get("/", (req, res) => {
  const mine = db.requests.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({
    incoming: mine.filter(r => r.toId === req.userId).map(view),
    outgoing: mine.filter(r => r.fromId === req.userId).map(view),
  });
});

/** POST /api/requests { toId, message } */
router.post("/", sendLimiter, (req, res) => {
  const toId = String(req.body.toId || "");
  const message = clean(req.body.message, 300);
  const target = db.users.find(u => u.id === toId && u.available);
  if (!target) return res.status(404).json({ error: "That partner is no longer available." });
  if (target.id === req.userId) return res.status(400).json({ error: "You can't send a request to yourself." });
  const dup = db.requests.find(
    r => r.fromId === req.userId && r.toId === toId && r.status === "pending"
  );
  if (dup) return res.status(409).json({ error: "You already have a pending request with this partner." });

  const r = {
    id: db.id(), fromId: req.userId, toId, message, status: "pending",
    createdAt: db.now(), updatedAt: db.now(),
  };
  db.requests.push(r);
  db.save();
  res.status(201).json({ request: view(r) });
});

/** PATCH /api/requests/:id { status: accepted | declined | cancelled } */
router.patch("/:id", (req, res) => {
  const r = db.requests.find(x => x.id === req.params.id);
  const status = String(req.body.status || "");
  if (!r || (r.toId !== req.userId && r.fromId !== req.userId)) {
    return res.status(404).json({ error: "Request not found." });
  }
  if (r.status !== "pending") return res.status(409).json({ error: `This request is already ${r.status}.` });

  const isRecipient = r.toId === req.userId;
  const allowed = isRecipient ? ["accepted", "declined"] : ["cancelled"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "That action isn't allowed." });

  r.status = status;
  r.updatedAt = db.now();
  if (status === "accepted") {
    for (const id of [r.fromId, r.toId]) {
      const u = db.users.find(x => x.id === id);
      if (u) u.walks = (u.walks || 0) + 1;
    }
  }
  db.save();
  res.json({ request: view(r) });
});

module.exports = router;
