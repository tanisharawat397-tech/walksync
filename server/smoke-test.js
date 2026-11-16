/* End-to-end API check: node server/smoke-test.js (uses a temporary database) */
const os = require("os");
const path = require("path");
const fs = require("fs");
const assert = require("assert");

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "walksync-")), "db.json");
process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
process.env.NODE_ENV = "test";

const app = require("./server");

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = "";
  }
  async call(method, url, body, headers = {}) {
    const res = await fetch(this.base + url, {
      method,
      headers: { "Content-Type": "application/json", ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }
}

const profile = { location: "Rajpur Road", time: "morning", pace: "steady", distanceKm: 4, bio: "Early walker who loves the hills." };
let passed = 0;
const check = (name, fn) => fn().then(() => { passed++; console.log("  ok  " + name); });

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = new Client(base);
  const b = new Client(base);
  try {
    await check("health", async () => assert.equal((await a.call("GET", "/api/health")).status, 200));
    await check("register validates input", async () => {
      assert.equal((await a.call("POST", "/api/auth/register", { name: "A", email: "bad", password: "x", gender: "z" })).status, 400);
    });
    await check("register + session", async () => {
      const r = await a.call("POST", "/api/auth/register", { name: "Asha Rao", email: "asha@test.dev", password: "Passw0rdOK", gender: "female" });
      assert.equal(r.status, 201);
      assert.equal(r.json.user.passwordHash, undefined);
      assert.equal((await a.call("GET", "/api/auth/me")).json.user.email, "asha@test.dev");
    });
    await check("duplicate email rejected", async () => {
      assert.equal((await b.call("POST", "/api/auth/register", { name: "Asha Two", email: "ASHA@test.dev", password: "Passw0rdOK", gender: "female" })).status, 409);
    });
    await check("wrong password rejected", async () => {
      assert.equal((await b.call("POST", "/api/auth/login", { email: "asha@test.dev", password: "nope12345" })).status, 401);
    });
    await check("profile requires auth, then publishes listing", async () => {
      assert.equal((await b.call("PUT", "/api/profile", profile)).status, 401);
      assert.equal((await a.call("PUT", "/api/profile", profile)).status, 200);
    });
    await check("second user registers and searches", async () => {
      await b.call("POST", "/api/auth/register", { name: "Vikram Joshi", email: "vik@test.dev", password: "Passw0rdOK", gender: "male" });
      const list = await b.call("GET", "/api/partners?location=rajpur&gender=female&time=morning");
      assert.equal(list.json.total, 1);
      assert.equal(list.json.partners[0].email, undefined, "emails must not leak");
      assert.equal((await b.call("GET", "/api/partners?gender=male")).json.total, 0);
    });
    let partnerId;
    await check("save / unsave partner", async () => {
      partnerId = (await b.call("GET", "/api/partners")).json.partners[0].id;
      assert.equal((await b.call("PUT", `/api/saved/${partnerId}`)).status, 200);
      assert.equal((await b.call("GET", "/api/partners?saved=1")).json.total, 1);
      assert.equal((await b.call("DELETE", `/api/saved/${partnerId}`)).status, 200);
      assert.equal((await b.call("GET", "/api/partners?saved=1")).json.total, 0);
    });
    let requestId;
    await check("send request, duplicate blocked, self blocked", async () => {
      const r = await b.call("POST", "/api/requests", { toId: partnerId, message: "Hi! Shall we walk tomorrow?", when: "6:30 AM" });
      assert.equal(r.status, 201);
      requestId = r.json.request.id;
      assert.equal(r.json.request.other.email, null, "email hidden until accepted");
      assert.equal((await b.call("POST", "/api/requests", { toId: partnerId, message: "again please" })).status, 409);
      const me = (await a.call("GET", "/api/auth/me")).json.user;
      assert.equal((await a.call("POST", "/api/requests", { toId: me.id, message: "myself" })).status, 400);
    });
    await check("only recipient can accept; contact revealed afterwards", async () => {
      assert.equal((await b.call("PATCH", `/api/requests/${requestId}`, { action: "accept" })).status, 400);
      const inbox = await a.call("GET", "/api/requests");
      assert.equal(inbox.json.pendingIncoming, 1);
      const ok = await a.call("PATCH", `/api/requests/${requestId}`, { action: "accept" });
      assert.equal(ok.json.request.status, "accepted");
      assert.equal(ok.json.request.other.email, "vik@test.dev");
      assert.equal((await b.call("GET", "/api/requests")).json.outgoing[0].other.email, "asha@test.dev");
    });
    await check("cross-origin writes blocked", async () => {
      const r = await b.call("POST", "/api/contact", { name: "X Y", email: "x@y.zz", message: "hello there friend" }, { Origin: "https://evil.example" });
      assert.equal(r.status, 403);
    });
    await check("contact form", async () => {
      assert.equal((await a.call("POST", "/api/contact", { name: "Sam", email: "sam@test.dev", message: "Great idea, thanks!" })).status, 201);
      assert.equal((await a.call("POST", "/api/contact", { name: "Sam", email: "sam@test.dev", message: "hi" })).status, 400);
    });
    await check("logout clears session", async () => {
      await a.call("POST", "/api/auth/logout");
      assert.equal((await a.call("GET", "/api/auth/me")).json.user, null);
    });
    console.log(`\nAll ${passed} checks passed.`);
    server.close(() => process.exit(0));
  } catch (err) {
    console.error("\nFAILED:", err.message);
    server.close(() => process.exit(1));
  }
});
