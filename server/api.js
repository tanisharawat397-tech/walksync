const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const db = require("./db");
const cfg = require("./config");
const { fail, clean, normalize, initials, EMAIL_RE, GENDERS, TIMES, PACES } = require("./validate");

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in a few minutes." },
});
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You're doing that too quickly. Please slow down." },
});

/* ---------- auth helpers ---------- */
const DUMMY_HASH = bcrypt.hashSync("walksync-dummy-password", 10);

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id }, cfg.secret, { expiresIn: cfg.tokenTtl });
  res.cookie(cfg.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cfg.isProd,
    maxAge: cfg.cookieMaxAgeMs,
    path: "/",
  });
}

router.use((req, _res, next) => {
  req.user = null;
  const token = req.cookies?.[cfg.cookieName];
  if (token) {
    try {
      const payload = jwt.verify(token, cfg.secret);
      req.user = db.load().users.find((u) => u.id === payload.sub) || null;
    } catch {
      /* invalid or expired token: treat as logged out */
    }
  }
  next();
});

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Please log in to continue." });

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  gender: u.gender,
  profile: u.profile || null,
});

function partnerView(u, viewer, savedIds, requests) {
  const p = u.profile;
  const mine = viewer ? requests.find((r) => r.fromId === viewer.id && r.toId === u.id && ["pending", "accepted"].includes(r.status)) : null;
  return {
    id: u.id,
    name: u.name,
    initials: initials(u.name),
    gender: u.gender,
    location: p.location,
    time: p.time,
    distanceKm: p.distanceKm,
    pace: p.pace,
    bio: p.bio,
    memberSince: u.createdAt,
    saved: savedIds.has(u.id),
    isMe: viewer?.id === u.id,
    requestStatus: mine ? mine.status : null,
  };
}

/* ---------- health & stats ---------- */
router.get("/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

router.get("/stats", (_req, res) => {
  const { users, requests } = db.load();
  const walkers = users.filter((u) => u.profile?.available);
  res.json({
    members: users.length,
    walkers: walkers.length,
    localities: new Set(walkers.map((u) => normalize(u.profile.location))).size,
    connections: requests.filter((r) => r.status === "accepted").length,
  });
});

/* ---------- auth ---------- */
router.post(
  "/auth/register",
  authLimiter,
  wrap(async (req, res) => {
    const name = clean(req.body.name, 50);
    const email = clean(req.body.email, 120).toLowerCase();
    const password = String(req.body.password ?? "");
    const gender = normalize(req.body.gender);

    if (name.length < 2) fail(400, "Please enter your name (at least 2 characters).");
    if (!EMAIL_RE.test(email)) fail(400, "Please enter a valid email address.");
    if (password.length < 8 || password.length > 72 || !/[a-z]/i.test(password) || !/\d/.test(password))
      fail(400, "Password must be 8-72 characters and include a letter and a number.");
    if (!GENDERS.includes(gender)) fail(400, "Please select your gender.");

    const store = db.load();
    if (store.users.some((u) => u.email === email)) fail(409, "An account with this email already exists.");

    const user = {
      id: db.id(),
      name,
      email,
      gender,
      passwordHash: await bcrypt.hash(password, 11),
      profile: null,
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    db.save();
    setSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  })
);

router.post(
  "/auth/login",
  authLimiter,
  wrap(async (req, res) => {
    const email = clean(req.body.email, 120).toLowerCase();
    const password = String(req.body.password ?? "");
    const user = db.load().users.find((u) => u.email === email);
    // Always run bcrypt so response time doesn't reveal whether the email exists.
    const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) fail(401, "Incorrect email or password.");
    setSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

router.post("/auth/logout", (_req, res) => {
  res.clearCookie(cfg.cookieName, { path: "/" });
  res.json({ ok: true });
});

router.get("/auth/me", (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

/* ---------- partner listings ---------- */
router.get("/partners", (req, res) => {
  const store = db.load();
  const location = normalize(req.query.location);
  const gender = normalize(req.query.gender || "all");
  const time = normalize(req.query.time || "all");
  const savedOnly = req.query.saved === "1";
  if (savedOnly && !req.user) fail(401, "Log in to see your saved partners.");

  const savedIds = new Set(req.user ? store.saved.filter((s) => s.userId === req.user.id).map((s) => s.partnerId) : []);

  const matches = store.users
    .filter((u) => u.profile?.available)
    .filter((u) => !location || normalize(u.profile.location).includes(location))
    .filter((u) => gender === "all" || u.gender === gender)
    .filter((u) => time === "all" || u.profile.time === time)
    .filter((u) => !savedOnly || savedIds.has(u.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const slice = matches.slice((page - 1) * limit, page * limit);

  res.json({
    partners: slice.map((u) => partnerView(u, req.user, savedIds, store.requests)),
    total: matches.length,
    page,
    pages: Math.max(Math.ceil(matches.length / limit), 1),
  });
});

router.get("/locations", (_req, res) => {
  const counts = new Map();
  for (const u of db.load().users) {
    if (!u.profile?.available) continue;
    const loc = u.profile.location;
    counts.set(loc, (counts.get(loc) || 0) + 1);
  }
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  res.json({ locations: list });
});

/* ---------- my walker profile ---------- */
router.put(
  "/profile",
  requireAuth,
  writeLimiter,
  wrap((req, res) => {
    const location = clean(req.body.location, 60);
    const time = normalize(req.body.time);
    const pace = normalize(req.body.pace || "steady");
    const distanceKm = Number(req.body.distanceKm);
    const bio = clean(req.body.bio, 240);

    if (location.length < 2) fail(400, "Please enter your locality.");
    if (!TIMES.includes(time)) fail(400, "Choose morning or evening.");
    if (!PACES.includes(pace)) fail(400, "Choose a valid walking pace.");
    if (!Number.isFinite(distanceKm) || distanceKm < 1 || distanceKm > 50) fail(400, "Distance must be between 1 and 50 km.");
    if (bio.length < 10) fail(400, "Tell others a little about yourself (at least 10 characters).");

    req.user.profile = { location, time, pace, distanceKm: Math.round(distanceKm * 10) / 10, bio, available: req.body.available !== false };
    db.save();
    res.json({ user: publicUser(req.user) });
  })
);

router.delete(
  "/profile",
  requireAuth,
  writeLimiter,
  wrap((req, res) => {
    req.user.profile = null;
    db.save();
    res.json({ user: publicUser(req.user) });
  })
);

/* ---------- saved partners ---------- */
function findPartnerOr404(id) {
  const partner = db.load().users.find((u) => u.id === id && u.profile);
  if (!partner) fail(404, "That walking partner could not be found.");
  return partner;
}

router.put(
  "/saved/:id",
  requireAuth,
  writeLimiter,
  wrap((req, res) => {
    const partner = findPartnerOr404(req.params.id);
    if (partner.id === req.user.id) fail(400, "You can't save your own profile.");
    const store = db.load();
    if (!store.saved.some((s) => s.userId === req.user.id && s.partnerId === partner.id)) {
      store.saved.push({ userId: req.user.id, partnerId: partner.id, createdAt: new Date().toISOString() });
      db.save();
    }
    res.json({ saved: true });
  })
);

router.delete(
  "/saved/:id",
  requireAuth,
  writeLimiter,
  wrap((req, res) => {
    const store = db.load();
    store.saved = store.saved.filter((s) => !(s.userId === req.user.id && s.partnerId === req.params.id));
    db.save();
    res.json({ saved: false });
  })
);

/* ---------- walk requests ---------- */
function requestView(r, me, users) {
  const outgoing = r.fromId === me.id;
  const other = users.find((u) => u.id === (outgoing ? r.toId : r.fromId));
  return {
    id: r.id,
    direction: outgoing ? "outgoing" : "incoming",
    status: r.status,
    when: r.when,
    message: r.message,
    createdAt: r.createdAt,
    other: {
      id: other?.id,
      name: other?.name || "Deleted user",
      initials: other ? initials(other.name) : "?",
      location: other?.profile?.location || null,
      // Contact details are only revealed once both people have agreed to walk.
      email: r.status === "accepted" ? other?.email || null : null,
    },
  };
}

router.get("/requests", requireAuth, (req, res) => {
  const { requests, users } = db.load();
  const mine = requests
    .filter((r) => r.fromId === req.user.id || r.toId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => requestView(r, req.user, users));
  res.json({
    incoming: mine.filter((r) => r.direction === "incoming"),
    outgoing: mine.filter((r) => r.direction === "outgoing"),
    pendingIncoming: mine.filter((r) => r.direction === "incoming" && r.status === "pending").length,
  });
});

router.post(
  "/requests",
  requireAuth,
  writeLimiter,
  wrap((req, res) => {
    const store = db.load();
    const partner = findPartnerOr404(String(req.body.toId || ""));
    if (!partner.profile.available) fail(409, `${partner.name} isn't taking requests right now.`);
    if (partner.id === req.user.id) fail(400, "You can't send a request to yourself.");
    const message = clean(req.body.message, 300);
    const when = clean(req.body.when, 60);
    if (message.length < 3) fail(400, "Add a short message so they know who you are.");

    const duplicate = store.requests.find((r) => r.fromId === req.user.id && r.toId === partner.id && r.status === "pending");
    if (duplicate) fail(409, `You already have a pending request to ${partner.name}.`);

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const recent = store.requests.filter((r) => r.fromId === req.user.id && Date.parse(r.createdAt) > dayAgo).length;
    if (recent >= 10) fail(429, "You've reached today's request limit. Try again tomorrow.");

    const request = { id: db.id(), fromId: req.user.id, toId: partner.id, message, when, status: "pending", createdAt: new Date().toISOString() };
    store.requests.push(request);
    db.save();
    res.status(201).json({ request: requestView(request, req.user, store.users) });
  })
);

router.patch(
  "/requests/:id",
  requireAuth,
  writeLimiter,
  wrap((req, res) => {
    const store = db.load();
    const request = store.requests.find((r) => r.id === req.params.id && (r.fromId === req.user.id || r.toId === req.user.id));
    if (!request) fail(404, "Request not found.");
    const action = normalize(req.body.action);
    const isRecipient = request.toId === req.user.id;

    if (request.status !== "pending") fail(409, "This request has already been answered.");
    if (isRecipient && action === "accept") request.status = "accepted";
    else if (isRecipient && action === "decline") request.status = "declined";
    else if (!isRecipient && action === "cancel") request.status = "cancelled";
    else fail(400, "That action isn't allowed on this request.");

    request.updatedAt = new Date().toISOString();
    db.save();
    res.json({ request: requestView(request, req.user, store.users) });
  })
);

/* ---------- contact form ---------- */
router.post(
  "/contact",
  writeLimiter,
  wrap((req, res) => {
    const name = clean(req.body.name, 60);
    const email = clean(req.body.email, 120).toLowerCase();
    const message = clean(req.body.message, 1000);
    if (name.length < 2) fail(400, "Please enter your name.");
    if (!EMAIL_RE.test(email)) fail(400, "Please enter a valid email address.");
    if (message.length < 10) fail(400, "Please write a message of at least 10 characters.");
    const store = db.load();
    store.messages.push({ id: db.id(), name, email, message, createdAt: new Date().toISOString() });
    db.save();
    res.status(201).json({ ok: true });
  })
);

router.use((_req, res) => res.status(404).json({ error: "Not found." }));

module.exports = router;
