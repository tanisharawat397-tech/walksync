"use strict";
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const isProd = process.env.NODE_ENV === "production";

let secret = process.env.JWT_SECRET;
if (!secret || secret === "change-me") {
  if (isProd) {
    console.error("FATAL: set a strong JWT_SECRET in production.");
    process.exit(1);
  }
  secret = crypto.randomBytes(32).toString("hex");
  console.warn("[auth] JWT_SECRET not set - using a random one (sessions reset on restart).");
}

const COOKIE = "walksync_token";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function issue(res, user) {
  const token = jwt.sign({ sub: user.id }, secret, { expiresIn: "7d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: MAX_AGE,
  });
}

function clear(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", secure: isProd });
}

function readUserId(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, secret).sub;
  } catch {
    return null;
  }
}

/** Attaches req.userId when logged in; never blocks. */
function optional(req, _res, next) {
  req.userId = readUserId(req);
  next();
}

/** Blocks unauthenticated requests. */
function required(req, res, next) {
  req.userId = readUserId(req);
  if (!req.userId) return res.status(401).json({ error: "Please log in to continue." });
  next();
}

module.exports = { issue, clear, optional, required };
