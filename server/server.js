require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const cfg = require("./config");
const api = require("./api");

const app = express();
app.disable("x-powered-by");
if (cfg.isProd) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: cfg.isProd ? [] : null,
      },
    },
  })
);

app.use(express.json({ limit: "20kb" }));
app.use(cookieParser());

// CSRF defence in depth (cookies are also SameSite=Lax): reject cross-origin writes.
app.use("/api", (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* fall through to rejection */
    }
    if (host !== req.headers.host) return res.status(403).json({ error: "Cross-origin request blocked." });
  }
  next();
});

app.use(
  "/api",
  rateLimit({ windowMs: 60 * 1000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests." } })
);
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", api);

app.use(express.static(path.join(__dirname, "..", "public"), { extensions: ["html"], maxAge: cfg.isProd ? "1h" : 0 }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body too large." });
  const status = err.status && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? "Something went wrong on our side." : err.message });
});

if (require.main === module) {
  app.listen(cfg.port, () => console.log(`WalkSync running at http://localhost:${cfg.port}`));
}

module.exports = app;
