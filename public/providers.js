const API_BASE = "https://happythoughts.proteeninjector.workers.dev";
const storageKey = "happythoughts_provider_token_session";

const form = document.getElementById("provider-auth-form");
const tokenInput = document.getElementById("provider-token");
const authStatus = document.getElementById("provider-auth-status");
const clearBtn = document.getElementById("provider-clear-btn");
const refreshBtn = document.getElementById("provider-refresh-btn");
const actionStatus = document.getElementById("provider-action-status");
const actionButtons = [...document.querySelectorAll("[data-provider-action]")];
const jobsList = document.getElementById("jobs-list");
const specialtiesEl = document.getElementById("provider-specialties");
const quickstartPoll = document.getElementById("quickstart-poll");
const quickstartRespond = document.getElementById("quickstart-respond");

const els = {
  statusDot: document.getElementById("provider-status-dot"),
  statusBadge: document.getElementById("provider-status-badge"),
  name: document.getElementById("provider-name"),
  slug: document.getElementById("provider-slug"),
  tier: document.getElementById("provider-tier"),
  trail: document.getElementById("provider-trail"),
  mode: document.getElementById("provider-mode"),
  deliveryStatus: document.getElementById("provider-delivery-status"),
  tokenCreated: document.getElementById("provider-token-created"),
  lastPoll: document.getElementById("provider-last-poll"),
  lastResponse: document.getElementById("provider-last-response"),
  queued: document.getElementById("provider-queued"),
  leased: document.getElementById("provider-leased"),
  status: document.getElementById("provider-status")
};

let currentToken = sessionStorage.getItem(storageKey) || "";
if (currentToken) tokenInput.value = currentToken;

function setNotice(el, text, tone = "default") {
  el.textContent = text;
  el.style.borderColor = tone === "error"
    ? "rgba(248, 113, 113, 0.25)"
    : tone === "success"
    ? "rgba(52, 211, 153, 0.25)"
    : "rgba(167, 139, 250, 0.16)";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusTone(status) {
  if (status === "ready" || status === "active") return "success";
  if (status === "paused") return "warning";
  return "error";
}

function paintDot(status) {
  els.statusDot.className = "dot";
  if (status === "paused") els.statusDot.classList.add("warning");
  if (status !== "ready" && status !== "active" && status !== "paused") els.statusDot.classList.add("error");
}

function updateQuickstarts(token) {
  const safe = token || "YOUR_TOKEN";
  quickstartPoll.textContent = `curl ${API_BASE}/provider/jobs/next \\
  -H "Authorization: Bearer ${safe}"`;
  quickstartRespond.textContent = `curl -X POST ${API_BASE}/provider/jobs/JOB_ID/respond \\
  -H "Authorization: Bearer ${safe}" \\
  -H "Content-Type: application/json" \\
  -d '{"thought":"Your response here","confidence":0.92}'`;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function renderJobs(me, polledJob) {
  clearChildren(jobsList);
  const pieces = [];
  if (polledJob?.job) {
    pieces.push({
      title: `${polledJob.job.job_id} · ${polledJob.job.specialty}`,
      body: polledJob.job.prompt,
      meta: `Leased now · deadline ${formatDate(polledJob.job.deadline_at)}`
    });
  }
  if (!pieces.length) {
    const empty = document.createElement("div");
    empty.className = "job-item job-empty";
    empty.textContent = me.delivery_status === "paused"
      ? "You’re paused. Routing is suspended until you resume."
      : "You’re live and ready. Jobs appear here when buyers route to you.";
    jobsList.appendChild(empty);
    return;
  }

  pieces.forEach((job) => {
    const item = document.createElement("div");
    item.className = "job-item";
    const title = document.createElement("h4");
    title.textContent = job.title;
    const body = document.createElement("p");
    body.textContent = job.body;
    const meta = document.createElement("div");
    meta.className = "job-meta";
    meta.textContent = job.meta;
    item.append(title, body, meta);
    jobsList.appendChild(item);
  });
}

function paintProvider(me, polledJob) {
  paintDot(me.delivery_status || me.status);
  els.statusBadge.textContent = `${(me.delivery_status || "unknown").toUpperCase()} · ${(me.delivery_mode || "hosted").toUpperCase()}`;
  els.name.textContent = me.name || "—";
  els.slug.textContent = me.slug || me.provider_id || "—";
  els.tier.textContent = me.tier || "—";
  els.trail.textContent = me.happy_trail == null ? "—" : `${me.happy_trail}/100`;
  els.mode.textContent = me.delivery_mode || "—";
  els.deliveryStatus.textContent = me.delivery_status || "—";
  els.tokenCreated.textContent = formatDate(me.provider_token_created_at);
  els.lastPoll.textContent = formatDate(me.last_provider_poll_at);
  els.lastResponse.textContent = formatDate(me.last_provider_response_at);
  els.queued.textContent = String(me.jobs?.queued ?? "—");
  els.leased.textContent = String(me.jobs?.leased ?? "—");
  els.status.textContent = me.status || "active";

  clearChildren(specialtiesEl);
  (me.specialties || []).forEach((specialty) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = specialty;
    specialtiesEl.appendChild(pill);
  });
  renderJobs(me, polledJob);
}

async function api(path, options = {}) {
  if (!currentToken) throw new Error("Missing provider token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${currentToken}`,
      ...(options.headers || {})
    }
  });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof data === "string" ? data : data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

async function loadProvider() {
  currentToken = tokenInput.value.trim();
  if (!currentToken) {
    setNotice(authStatus, "Paste a provider token first.", "error");
    return;
  }
  sessionStorage.setItem(storageKey, currentToken);
  updateQuickstarts(currentToken);
  setNotice(authStatus, "Loading provider status…");
  try {
    const me = await api("/provider/me");
    const polledJob = await api("/provider/jobs/next");
    paintProvider(me, polledJob);
    setNotice(authStatus, `Loaded ${me.name}. Delivery mode: ${me.delivery_mode}.`, "success");
  } catch (err) {
    setNotice(authStatus, err.message || "Failed to load provider.", "error");
  }
}

async function runAction(action) {
  if (!currentToken) {
    setNotice(actionStatus, "Load a provider token first.", "error");
    return;
  }
  const routes = {
    pause: "/provider/control/pause",
    resume: "/provider/control/resume",
    rotate: "/provider/token/rotate",
    revoke: "/provider/control/revoke-token"
  };
  try {
    const data = await api(routes[action], { method: "POST" });
    if (action === "rotate" && data.provider_token) {
      currentToken = data.provider_token;
      tokenInput.value = currentToken;
      sessionStorage.setItem(storageKey, currentToken);
      updateQuickstarts(currentToken);
    }
    if (action === "revoke") {
      sessionStorage.removeItem(storageKey);
    }
    setNotice(actionStatus, JSON.stringify(data, null, 2), "success");
    await loadProvider();
  } catch (err) {
    setNotice(actionStatus, err.message || `Failed to ${action}.`, "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadProvider();
});

refreshBtn.addEventListener("click", async () => {
  await loadProvider();
});

clearBtn.addEventListener("click", () => {
  currentToken = "";
  tokenInput.value = "";
  sessionStorage.removeItem(storageKey);
  updateQuickstarts("");
  setNotice(authStatus, "Token cleared.");
});

actionButtons.forEach((btn) => {
  btn.addEventListener("click", async () => runAction(btn.dataset.providerAction));
});

updateQuickstarts(currentToken);
if (currentToken) loadProvider();
