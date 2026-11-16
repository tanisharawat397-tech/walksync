/* WalkSync front end - talks to the Express API in /server */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const SVG_NS = "http://www.w3.org/2000/svg";

  const state = { user: null, page: 1, pages: 1, total: 0, loading: false, requests: null, walksTab: "incoming", requestTarget: null, authMode: "login" };

  /* ---------- helpers ---------- */
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "i");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#i-" + name);
    svg.append(use);
    return svg;
  }

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [key, val] of Object.entries(attrs)) {
      if (val == null || val === false) continue;
      if (key === "class") el.className = val;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), val);
      else el.setAttribute(key, val === true ? "" : val);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return el;
  }

  let toastTimer;
  function toast(message, isError = false) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  async function api(path, { method = "GET", body } = {}) {
    let res;
    try {
      res = await fetch("/api" + path, {
        method,
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("Can't reach the server. Check your connection and try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Something went wrong.");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function showError(el, message) {
    el.textContent = message;
    el.hidden = !message;
  }

  const debounce = (fn, ms) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  const avatarClass = (g) => (g === "female" ? "av-f" : g === "male" ? "av-m" : "av-o");

  async function withBusy(button, fn) {
    button.disabled = true;
    try { return await fn(); } finally { button.disabled = false; }
  }

  /* ---------- dialogs ---------- */
  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }
  $$("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
    $$("[data-close]", dialog).forEach((btn) => btn.addEventListener("click", () => dialog.close()));
  });

  /* ---------- auth ---------- */
  function renderAuth() {
    const area = $("#authArea");
    area.replaceChildren();
    if (!state.user) {
      area.append(
        h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: () => openAuth("login") }, "Log in"),
        h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => openAuth("register") }, "Sign up")
      );
      return;
    }
    const pending = state.requests ? state.requests.pendingIncoming : 0;
    area.append(
      h("span", { class: "user-chip" }, h("span", { class: "avatar " + avatarClass(state.user.gender) }, initials(state.user.name)), h("span", { class: "user-name" }, state.user.name.split(" ")[0])),
      h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: openWalks }, "My walks", pending ? h("span", { class: "badge" }, String(pending)) : null),
      h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: logout }, "Log out")
    );
  }

  const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  function setAuthMode(mode) {
    state.authMode = mode;
    const reg = mode === "register";
    $("#tabLogin").setAttribute("aria-selected", String(!reg));
    $("#tabRegister").setAttribute("aria-selected", String(reg));
    $$(".reg-only").forEach((el) => (el.hidden = !reg));
    $("#aName").required = reg;
    $("#aGender").required = reg;
    $("#aPassword").autocomplete = reg ? "new-password" : "current-password";
    $("#authTitle").textContent = reg ? "Create your account" : "Welcome back";
    $("#authSubmit").textContent = reg ? "Create account" : "Log in";
    showError($("#authError"), "");
  }

  function openAuth(mode = "login", note) {
    setAuthMode(mode);
    $("#authNote").textContent = note || (mode === "register" ? "Join WalkSync to list yourself and send walk requests." : "Log in to save partners and send walk requests.");
    openDialog($("#authDialog"));
    $("#aEmail").focus();
  }

  async function loadSession() {
    try {
      state.user = (await api("/auth/me")).user;
    } catch {
      state.user = null;
    }
    if (state.user) await refreshRequests(true);
    renderAuth();
  }

  async function logout() {
    try { await api("/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    state.user = null;
    state.requests = null;
    $("#savedOnly").checked = false;
    renderAuth();
    loadPartners({ reset: true });
    toast("You've been logged out.");
  }

  /* ---------- stats & locations ---------- */
  async function loadStats() {
    try {
      const s = await api("/stats");
      $("#statWalkers").textContent = s.walkers;
      $("#statLocalities").textContent = s.localities;
      $("#statConnections").textContent = s.connections;
    } catch { /* non-critical */ }
  }

  async function loadLocations() {
    try {
      const { locations } = await api("/locations");
      const wrap = $("#popular");
      $$("button", wrap).forEach((b) => b.remove());
      locations.slice(0, 5).forEach((loc) => {
        wrap.append(h("button", { type: "button", "data-location": loc.name, onclick: () => {
          $("#location").value = loc.name;
          markPopular();
          loadPartners({ reset: true });
        } }, loc.name));
      });
      markPopular();
    } catch { /* non-critical */ }
  }

  function markPopular() {
    const val = $("#location").value.trim().toLowerCase();
    $$("#popular button").forEach((b) => b.classList.toggle("active", b.dataset.location.toLowerCase() === val));
  }

  /* ---------- partners ---------- */
  function filters() {
    const params = new URLSearchParams();
    const location = $("#location").value.trim();
    if (location) params.set("location", location);
    params.set("gender", $("#gender").value);
    params.set("time", $("#walkTime").value);
    if ($("#savedOnly").checked) params.set("saved", "1");
    return params;
  }

  async function loadPartners({ reset = false } = {}) {
    if (state.loading && !reset) return;
    const grid = $("#partnerContainer");
    const requestedPage = reset ? 1 : state.page + 1;
    const token = (loadPartners.token = (loadPartners.token || 0) + 1);
    state.loading = true;

    if (reset) {
      grid.setAttribute("aria-busy", "true");
      grid.replaceChildren(...[0, 1, 2, 3].map(() => h("div", { class: "skeleton" })));
      $("#emptyMessage").hidden = true;
      $("#loadMore").hidden = true;
    }

    const params = filters();
    params.set("page", requestedPage);
    params.set("limit", 8);

    try {
      const data = await api("/partners?" + params);
      if (token !== loadPartners.token) return; // a newer search superseded this one
      if (reset) grid.replaceChildren();
      state.page = data.page;
      state.pages = data.pages;
      state.total = data.total;
      data.partners.forEach((p) => grid.append(partnerCard(p)));
      updateSummary();
    } catch (err) {
      if (token !== loadPartners.token) return;
      if (err.status === 401) {
        $("#savedOnly").checked = false;
        grid.replaceChildren();
        openAuth("login", "Log in to see the partners you've saved.");
        return loadPartners({ reset: true });
      }
      grid.replaceChildren();
      $("#resultCount").textContent = "We couldn't load partners.";
      toast(err.message, true);
    } finally {
      if (token === loadPartners.token) {
        state.loading = false;
        grid.setAttribute("aria-busy", "false");
      }
    }
  }

  function updateSummary() {
    const total = state.total;
    $("#resultCount").textContent = total ? `${total} walking partner${total === 1 ? "" : "s"} found` : "No matches";
    const empty = total === 0;
    $("#emptyMessage").hidden = !empty;
    if (empty) {
      $("#emptyText").textContent = $("#savedOnly").checked
        ? "You haven't saved anyone who matches yet. Tap Save on a partner card."
        : "Try a different locality or loosen your filters.";
    }
    $("#loadMore").hidden = state.page >= state.pages;
  }

  function partnerCard(p) {
    const saveBtn = h("button", {
      class: "save-btn", type: "button", "aria-pressed": String(p.saved),
      "aria-label": `${p.saved ? "Remove" : "Save"} ${p.name}`,
      onclick: () => toggleSave(p, saveBtn),
    }, icon("heart"), p.saved ? "Saved" : "Save");

    let reqLabel = "Request walk";
    if (p.isMe) reqLabel = "This is your listing";
    else if (p.requestStatus === "pending") reqLabel = "Request pending";
    else if (p.requestStatus === "accepted") reqLabel = "Request accepted";

    const reqBtn = h("button", {
      class: "request-btn", type: "button", disabled: p.isMe || !!p.requestStatus,
      onclick: () => openRequest(p),
    }, p.isMe || p.requestStatus ? null : icon("users"), reqLabel);

    return h("article", { class: "partner-card" },
      p.isMe ? null : saveBtn,
      h("div", { class: "profile" },
        h("span", { class: "avatar " + avatarClass(p.gender), "aria-hidden": "true" }, p.initials),
        h("div", {},
          h("h3", {}, p.name.split(" ")[0] + (p.name.includes(" ") ? " " + p.name.split(" ").slice(1).map((w) => w[0] + ".").join(" ") : "")),
          h("p", { class: "loc" }, icon("pin"), p.location),
          h("span", { class: "status" }, "Available")
        )
      ),
      h("div", { class: "tags" },
        h("span", { class: "tag" }, icon(p.time === "morning" ? "sun" : "moon"), cap(p.time)),
        h("span", { class: "tag" }, icon("route"), `${p.distanceKm} km`),
        h("span", { class: "tag" }, icon("pace"), cap(p.pace) + " pace"),
        h("span", { class: "tag" }, icon("user"), cap(p.gender))
      ),
      h("p", { class: "bio" }, p.bio),
      reqBtn
    );
  }

  async function toggleSave(p, btn) {
    if (!state.user) return openAuth("login", "Log in to save walking partners.");
    await withBusy(btn, async () => {
      try {
        await api(`/saved/${p.id}`, { method: p.saved ? "DELETE" : "PUT" });
        p.saved = !p.saved;
        toast(p.saved ? `${p.name.split(" ")[0]} added to your saved partners` : `${p.name.split(" ")[0]} removed from saved partners`);
        if ($("#savedOnly").checked) loadPartners({ reset: true });
        else btn.replaceWith(rebuildSave(p));
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  function rebuildSave(p) {
    const fresh = h("button", {
      class: "save-btn", type: "button", "aria-pressed": String(p.saved),
      "aria-label": `${p.saved ? "Remove" : "Save"} ${p.name}`,
      onclick: () => toggleSave(p, fresh),
    }, icon("heart"), p.saved ? "Saved" : "Save");
    return fresh;
  }

  /* ---------- walk requests ---------- */
  function openRequest(p) {
    if (!state.user) return openAuth("login", `Log in to send ${p.name.split(" ")[0]} a walk request.`);
    state.requestTarget = p;
    $("#requestSub").textContent = `Introduce yourself to ${p.name.split(" ")[0]} - ${p.location}, ${p.time}.`;
    $("#rWhen").value = "";
    $("#rMessage").value = "";
    showError($("#requestError"), "");
    openDialog($("#requestDialog"));
    $("#rMessage").focus();
  }

  async function submitRequest(e) {
    e.preventDefault();
    const btn = $("button[type=submit]", e.target);
    const message = $("#rMessage").value.trim();
    if (message.length < 3) return showError($("#requestError"), "Add a short message so they know who you are.");
    await withBusy(btn, async () => {
      try {
        await api("/requests", { method: "POST", body: { toId: state.requestTarget.id, message, when: $("#rWhen").value.trim() } });
        $("#requestDialog").close();
        toast(`Request sent to ${state.requestTarget.name.split(" ")[0]}!`);
        await refreshRequests();
        renderAuth();
        loadPartners({ reset: true });
      } catch (err) {
        showError($("#requestError"), err.message);
      }
    });
  }

  async function refreshRequests(silent) {
    try {
      state.requests = await api("/requests");
    } catch (err) {
      if (!silent) toast(err.message, true);
    }
  }

  async function openWalks() {
    await refreshRequests();
    renderAuth();
    renderWalks();
    openDialog($("#walksDialog"));
  }

  function setWalksTab(tab) {
    state.walksTab = tab;
    $("#tabIncoming").setAttribute("aria-selected", String(tab === "incoming"));
    $("#tabOutgoing").setAttribute("aria-selected", String(tab === "outgoing"));
    renderWalks();
  }

  function renderWalks() {
    const list = $("#walksList");
    list.replaceChildren();
    const data = state.requests || { incoming: [], outgoing: [], pendingIncoming: 0 };
    const count = $("#incomingCount");
    count.hidden = !data.pendingIncoming;
    count.textContent = data.pendingIncoming;

    const items = data[state.walksTab];
    if (!items.length) {
      list.append(h("p", { class: "walks-empty" }, state.walksTab === "incoming" ? "No requests yet. Once you list yourself, walkers can reach out." : "You haven't sent any requests yet. Find a partner and say hello!"));
    }
    items.forEach((r) => list.append(walkItem(r)));

    $("#profileStatus").textContent = state.user?.profile
      ? `Listed in ${state.user.profile.location} (${state.user.profile.available ? "visible" : "hidden"} in search).`
      : "You're not listed as a walking partner yet.";
    $("#editProfileBtn").textContent = state.user?.profile ? "Edit walking profile" : "List yourself";
  }

  function walkItem(r) {
    const actions = [];
    if (r.status === "pending" && r.direction === "incoming") {
      actions.push(
        h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: (e) => respond(r, "accept", e.currentTarget) }, "Accept"),
        h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: (e) => respond(r, "decline", e.currentTarget) }, "Decline")
      );
    } else if (r.status === "pending") {
      actions.push(h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: (e) => respond(r, "cancel", e.currentTarget) }, "Cancel request"));
    }
    return h("div", { class: "walk-item" },
      h("span", { class: "avatar av-o", "aria-hidden": "true" }, r.other.initials),
      h("div", {},
        h("div", { class: "walk-top" }, h("strong", {}, r.other.name), h("span", { class: "pill pill-" + r.status }, r.status)),
        h("div", { class: "walk-meta" }, [r.other.location, r.when, new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })].filter(Boolean).join(" • ")),
        h("p", { class: "walk-msg" }, r.message),
        r.other.email ? h("div", { class: "walk-contact" }, "Contact: ", h("a", { href: "mailto:" + r.other.email }, r.other.email)) : null,
        actions.length ? h("div", { class: "walk-actions" }, actions) : null
      )
    );
  }

  async function respond(r, action, btn) {
    await withBusy(btn, async () => {
      try {
        await api(`/requests/${r.id}`, { method: "PATCH", body: { action } });
        await refreshRequests();
        renderAuth();
        renderWalks();
        loadStats();
        loadPartners({ reset: true });
        toast(action === "accept" ? "Request accepted - contact details are now shared." : action === "decline" ? "Request declined." : "Request cancelled.");
      } catch (err) {
        toast(err.message, true);
        await refreshRequests();
        renderWalks();
      }
    });
  }

  /* ---------- my profile ---------- */
  function openProfile() {
    if (!state.user) return openAuth("register", "Create an account to list yourself as a walking partner.");
    const p = state.user.profile;
    $("#pLocation").value = p?.location || "";
    $("#pTime").value = p?.time || "morning";
    $("#pPace").value = p?.pace || "steady";
    $("#pDistance").value = p?.distanceKm || 4;
    $("#pBio").value = p?.bio || "";
    $("#pAvailable").checked = p ? p.available : true;
    $("#removeProfile").hidden = !p;
    showError($("#profileError"), "");
    $("#walksDialog").close();
    openDialog($("#profileDialog"));
  }

  async function submitProfile(e) {
    e.preventDefault();
    const btn = $("button[type=submit]", e.target);
    await withBusy(btn, async () => {
      try {
        const { user } = await api("/profile", { method: "PUT", body: {
          location: $("#pLocation").value, time: $("#pTime").value, pace: $("#pPace").value,
          distanceKm: $("#pDistance").value, bio: $("#pBio").value, available: $("#pAvailable").checked,
        } });
        state.user = user;
        $("#profileDialog").close();
        toast("Your walking profile is saved.");
        loadPartners({ reset: true }); loadStats(); loadLocations();
      } catch (err) {
        showError($("#profileError"), err.message);
      }
    });
  }

  async function removeProfile() {
    if (!confirm("Remove your walking listing? Existing requests are kept.")) return;
    try {
      const { user } = await api("/profile", { method: "DELETE" });
      state.user = user;
      $("#profileDialog").close();
      toast("Your listing has been removed.");
      loadPartners({ reset: true }); loadStats(); loadLocations();
    } catch (err) {
      showError($("#profileError"), err.message);
    }
  }

  /* ---------- wiring ---------- */
  async function submitAuth(e) {
    e.preventDefault();
    const reg = state.authMode === "register";
    const body = { email: $("#aEmail").value, password: $("#aPassword").value };
    if (reg) { body.name = $("#aName").value; body.gender = $("#aGender").value; }
    const btn = $("#authSubmit");
    await withBusy(btn, async () => {
      try {
        const { user } = await api(reg ? "/auth/register" : "/auth/login", { method: "POST", body });
        state.user = user;
        $("#authDialog").close();
        $("#authForm").reset();
        await refreshRequests(true);
        renderAuth();
        loadPartners({ reset: true });
        loadStats();
        toast(reg ? `Welcome to WalkSync, ${user.name.split(" ")[0]}!` : `Welcome back, ${user.name.split(" ")[0]}!`);
        if (reg && !user.profile) setTimeout(() => toast("Tip: list yourself so others can find you."), 3400);
      } catch (err) {
        showError($("#authError"), err.message);
      }
    });
  }

  async function submitContact(e) {
    e.preventDefault();
    const btn = $("button[type=submit]", e.target);
    await withBusy(btn, async () => {
      try {
        await api("/contact", { method: "POST", body: { name: $("#cName").value, email: $("#cEmail").value, message: $("#cMessage").value } });
        e.target.reset();
        showError($("#contactError"), "");
        toast("Thanks! Your message has been sent.");
      } catch (err) {
        showError($("#contactError"), err.message);
      }
    });
  }

  function clearFilters() {
    $("#location").value = "";
    $("#gender").value = "all";
    $("#walkTime").value = "all";
    $("#savedOnly").checked = false;
    markPopular();
    loadPartners({ reset: true });
  }

  function initNav() {
    const header = $("#siteHeader");
    const btn = $("#menuBtn");
    btn.addEventListener("click", () => {
      const open = header.classList.toggle("nav-open");
      btn.setAttribute("aria-expanded", String(open));
    });
    $$("#navLinks a").forEach((a) => a.addEventListener("click", () => { header.classList.remove("nav-open"); btn.setAttribute("aria-expanded", "false"); }));

    const links = $$("#navLinks a");
    const sections = links.map((a) => $(a.getAttribute("href"))).filter(Boolean);
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id));
        });
      }, { rootMargin: "-40% 0px -55% 0px" });
      sections.forEach((s) => io.observe(s));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    initNav();

    $("#searchForm").addEventListener("submit", (e) => { e.preventDefault(); markPopular(); loadPartners({ reset: true }); });
    $("#clearButton").addEventListener("click", clearFilters);
    $("#location").addEventListener("input", debounce(() => { markPopular(); loadPartners({ reset: true }); }, 300));
    $("#gender").addEventListener("change", () => loadPartners({ reset: true }));
    $("#walkTime").addEventListener("change", () => loadPartners({ reset: true }));
    $("#savedOnly").addEventListener("change", () => {
      if ($("#savedOnly").checked && !state.user) {
        $("#savedOnly").checked = false;
        return openAuth("login", "Log in to see the partners you've saved.");
      }
      loadPartners({ reset: true });
    });
    $("#loadMore").addEventListener("click", () => loadPartners());

    $("#tabLogin").addEventListener("click", () => setAuthMode("login"));
    $("#tabRegister").addEventListener("click", () => setAuthMode("register"));
    $("#authForm").addEventListener("submit", submitAuth);
    $("#requestForm").addEventListener("submit", submitRequest);
    $("#profileForm").addEventListener("submit", submitProfile);
    $("#removeProfile").addEventListener("click", removeProfile);
    $("#contactForm").addEventListener("submit", submitContact);
    $("#tabIncoming").addEventListener("click", () => setWalksTab("incoming"));
    $("#tabOutgoing").addEventListener("click", () => setWalksTab("outgoing"));
    $("#editProfileBtn").addEventListener("click", openProfile);
    $("#listBtn").addEventListener("click", openProfile);
    $("#heroListBtn").addEventListener("click", openProfile);

    await loadSession();
    loadPartners({ reset: true });
    loadStats();
    loadLocations();
  });
})();
