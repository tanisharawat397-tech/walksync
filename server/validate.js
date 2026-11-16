class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new HttpError(status, message);
};

/** Trim, collapse whitespace, strip control characters, cap length. */
const clean = (value, max = 200) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const normalize = (value) => clean(value, 100).toLowerCase();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GENDERS = ["male", "female", "other"];
const TIMES = ["morning", "evening"];
const PACES = ["relaxed", "steady", "brisk"];

const initials = (name) =>
  clean(name, 60)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

module.exports = { HttpError, fail, clean, normalize, initials, EMAIL_RE, GENDERS, TIMES, PACES };
