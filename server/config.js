const crypto = require("crypto");

const isProd = process.env.NODE_ENV === "production";
let secret = process.env.JWT_SECRET;

if (!secret || secret === "change-me") {
  if (isProd) {
    console.error("[walksync] JWT_SECRET must be set to a long random string in production.");
    process.exit(1);
  }
  secret = crypto.randomBytes(32).toString("hex");
  console.warn("[walksync] JWT_SECRET not set - using a temporary secret (sessions reset on restart).");
}

module.exports = {
  isProd,
  secret,
  port: Number(process.env.PORT) || 3000,
  cookieName: "ws_token",
  tokenTtl: "7d",
  cookieMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
};
