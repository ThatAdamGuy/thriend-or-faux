// content.js

const TOF_PANEL_ID      = "tof-panel";
const TOF_SIDE_PANEL_ID = "tof-side-panel";
const postsCache = new Map(); // username → { result, callbacks } (session-level; background adds persistent cache)

// Starts the posts+replies fetch for a username (idempotent — reuses in-flight or completed entries).
function ensurePostsFetch(username, force = false) {
  let entry = postsCache.get(username);
  if (entry && !force) return entry;
  entry = { result: undefined, callbacks: [] };
  postsCache.set(username, entry);
  try {
    chrome.runtime.sendMessage({ type: "FETCH_POSTS", username, force }, (resp) => {
      if (chrome.runtime.lastError) resp = { success: false };
      entry.result = resp;
      entry.callbacks.forEach(cb => cb(resp));
      entry.callbacks = [];
    });
  } catch (e) {
    entry.result = { success: false };
  }
  return entry;
}

function onPostsReady(entry, cb) {
  if (entry.result !== undefined) cb(entry.result);
  else entry.callbacks.push(cb);
}

// --- Hover card (quick stats) ---

function getOrCreatePanel() {
  let panel = document.getElementById(TOF_PANEL_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = TOF_PANEL_ID;
    document.body.appendChild(panel);
    panel.addEventListener("click", (e) => {
      if (!e.target.closest(".tof-panel-close-x")) return;
      hidePanel();
      activeCard = null;
      clearTimeout(hideTimer);
    });
  }
  return panel;
}

function showPanel(card) {
  const panel = getOrCreatePanel();
  const username      = extractUsernameFromCard(card);
  const followersText = extractFollowersFromCard(card);

  const rect = card.getBoundingClientRect();
  panel.style.top   = (rect.bottom + window.scrollY + 6) + "px";
  panel.style.left  = rect.left + "px";
  panel.style.width = rect.width + "px";

  const fetchedId = `tof-f-${Date.now()}`;
  panel.innerHTML = `
    <button class="tof-panel-close-x" title="Close">×</button>
    <div class="tof-card-header">Thriend Or Faux 👁</div>
    <div class="tof-card-row">
      <span class="tof-card-label">Followers</span>
      <span class="tof-card-value">${followersText ?? "…"}</span>
    </div>
    <div id="${fetchedId}">
      <div class="tof-card-row"><span class="tof-card-label">Following</span><span class="tof-card-value tof-fetching">…</span></div>
      <div class="tof-card-row"><span class="tof-card-label">Follower / following ratio</span><span class="tof-card-value tof-fetching">…</span></div>
      <div class="tof-card-row"><span class="tof-card-label">Threads posted</span><span class="tof-card-value tof-fetching">…</span></div>
    </div>
  `;
  panel.classList.add("tof-visible");

  // Geometry-based "safe zone" instead of DOM containment — Threads renders the
  // actual hover-card content in a different subtree than the element whose
  // `hidden` attribute we observe (looks like a portal), so contains() checks
  // against it are unreliable. Pixel bounds don't care about that structure.
  const panelRect = panel.getBoundingClientRect();
  const pad = 14;
  safeZoneRect = {
    left:   Math.min(rect.left, panelRect.left) - pad,
    right:  Math.max(rect.right, panelRect.right) + pad,
    top:    rect.top - pad,
    bottom: panelRect.bottom + pad,
  };

  if (!username) return;

  // Preload posts + replies only if the hover survives a debounce — drive-by hovers
  // while scrolling shouldn't each spawn two background tabs. (Repeat visits within
  // the TTL are served from the persistent cache and never open tabs at all.)
  clearTimeout(preloadTimer);
  preloadTimer = setTimeout(() => {
    const p = document.getElementById(TOF_PANEL_ID);
    if (p && p.classList.contains("tof-visible")) ensurePostsFetch(username);
  }, 800);

  // Fetch profile stats (followers, ratio, thread count, bio)
  try {
    chrome.runtime.sendMessage({ type: "FETCH_PROFILE", username }, (response) => {
      if (chrome.runtime.lastError) return;
      const container = document.getElementById(fetchedId);
      if (!container) return;

      const d    = response?.success ? response.data : {};
      const rows = container.querySelectorAll(".tof-card-row");

      function fill(row, value) {
        const val = row.querySelector(".tof-card-value");
        if (val) { val.textContent = value || "unavailable"; val.classList.remove("tof-fetching"); }
      }
      fill(rows[0], d.following != null ? d.following.toLocaleString() : null);
      fill(rows[1], d.ratio ? `${d.ratio}x` : null);
      fill(rows[2], d.threadCount);

      // Add Analyze button
      const btn = document.createElement("button");
      btn.className   = "tof-analyze-btn";
      btn.textContent = "Analyze posts →";
      container.appendChild(btn);

      btn.addEventListener("click", () => {
        btn.disabled    = true;
        btn.textContent = "Opening…";
        openSidePanel(username, d, ensurePostsFetch(username));
      });
    });
  } catch (e) {}
}

function hidePanel() {
  const panel = document.getElementById(TOF_PANEL_ID);
  if (panel) panel.classList.remove("tof-visible");
  safeZoneRect = null;
  clearTimeout(preloadTimer);
}

// --- Side panel (full analysis) ---

function getOrCreateSidePanel() {
  let panel = document.getElementById(TOF_SIDE_PANEL_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = TOF_SIDE_PANEL_ID;
    panel.innerHTML = `
      <div id="tof-panel-header">
        <span id="tof-panel-title">😇 <span class="tof-logo-thriend">Thriend</span> <span class="tof-logo-or">or</span> <span class="tof-logo-faux">Faux</span> 😈</span>
        <button id="tof-panel-close">×</button>
      </div>
      <div id="tof-panel-body">
        <div id="tof-panel-content"></div>
        <div id="tof-about"></div>
      </div>
    `;
    document.body.appendChild(panel);
    document.getElementById("tof-panel-close").addEventListener("click", () => {
      panel.classList.remove("tof-visible");
    });
    fetch(chrome.runtime.getURL("about.html"))
      .then(r => r.text())
      .then(html => {
        const el = document.getElementById("tof-about");
        if (el) el.innerHTML = html +
          `<p class="tof-version">Test build · v${chrome.runtime.getManifest().version}</p>`;
      })
      .catch(() => {});
  }
  return panel;
}

function openSidePanel(username, profileData, postsEntry, forceAnalysis = false) {
  const sidePanel = getOrCreateSidePanel();
  const content   = document.getElementById("tof-panel-content");

  // Snapshot reflects when the data was actually fetched (may be a cached read)
  const fetchedAt = profileData.fetchedAt ?? Date.now();
  const isCached  = Date.now() - fetchedAt > 2 * 60 * 1000;
  const now      = new Date(fetchedAt);
  const timeStr  = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                      .toLowerCase().replace(" ", "").replace(" ", "");
  const dateStr  = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const snapshot = `${timeStr} ${dateStr}${isCached ? " · cached" : ""}`;

  // Followers vs following as one proportional split bar — the center tick is the
  // 1:1 balance point, so the fill instantly reads as "audience vs. audience-seeker".
  const f = profileData.followers ?? null;
  const g = profileData.following ?? null;
  let ffVizHtml = "";
  const rows = [];
  if (f != null && g != null && f + g > 0) {
    const pct = Math.min(98, Math.max(2, (f / (f + g)) * 100)); // clamp so tiny sides stay visible
    const r = g > 0 ? f / g : Infinity;
    const balance =
      r === Infinity ? "follows no one" :
      r >= 3         ? "followed far more than they follow" :
      r >= 1.2       ? "more followed than following" :
      r >= 0.8       ? "roughly balanced" :
      r >= 0.33      ? "follows more than followed" :
                       "follows far more than they're followed";
    ffVizHtml = `
      <div class="tof-ff-viz">
        <div class="tof-ff-labels">
          <span><strong>${f.toLocaleString()}</strong> followers</span>
          <span><strong>${g.toLocaleString()}</strong> following</span>
        </div>
        <div class="tof-ff-bar"><div class="tof-ff-followers" style="width:${pct}%"></div><div class="tof-ff-following"></div></div>
        <div class="tof-ff-ratio">${profileData.ratio ? profileData.ratio + "x · " : ""}${balance}</div>
      </div>`;
  } else {
    rows.push(
      ["Followers", f?.toLocaleString() ?? "—"],
      ["Following", g?.toLocaleString() ?? "—"],
      ["Ratio",     profileData.ratio ? profileData.ratio + "x" : "—"],
    );
  }
  rows.push(["Threads posted", profileData.threadCount ?? "—"]);
  const statsRows = rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("");

  const bioHtml = profileData.bio
    ? `<p class="tof-bio">"${profileData.bio}"</p>` : "";
  const urlDisplay = profileData.externalUrl
    ? profileData.externalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : null;
  const urlHtml = urlDisplay
    ? `<p class="tof-profile-url"><a href="${profileData.externalUrl}" target="_blank">🔗 ${urlDisplay}</a></p>`
    : "";

  content.innerHTML = `
    <div class="tof-section-meta">
      <div class="tof-section-tag">Threads data</div>
      <div class="tof-profile">
        <h2><a href="https://www.threads.com/@${username}" target="_blank">@${username}${profileData.isVerified ? " ✓" : ""}</a></h2>
        <span class="tof-snapshot">Snapshot: ${snapshot} <a href="#" id="tof-refresh" title="Re-fetch data and re-analyze">↻ refresh</a></span>
        ${bioHtml}
        ${urlHtml}
        ${ffVizHtml}
        <table class="tof-stats-table"><tbody>${statsRows}</tbody></table>
      </div>
    </div>
    <div class="tof-section-claude">
      <div class="tof-section-tag">Claude AI</div>
      <div id="tof-analysis-area"><p class="tof-loading">Loading posts…</p></div>
    </div>
  `;
  sidePanel.classList.add("tof-visible");

  document.getElementById("tof-refresh")?.addEventListener("click", (e) => {
    e.preventDefault();
    refreshProfile(username);
  });

  function showAnalysisError(msg, retry) {
    const area = document.getElementById("tof-analysis-area");
    if (!area) return;
    area.innerHTML = `<p class="tof-error">${msg}</p>`;
    const btn = document.createElement("button");
    btn.className   = "tof-analyze-btn";
    btn.textContent = "Try again";
    btn.addEventListener("click", retry);
    area.appendChild(btn);
  }

  function doAnalysis(resp) {
    const area = document.getElementById("tof-analysis-area");
    if (!area) return;
    // Proceed even with empty posts — Claude can still assess from bio + stats
    const { posts = [], replies = [], postsLoaded = false, repliesLoaded = false, notFound = false } = (resp?.success ? resp : {});

    // Reply frequency is computed from the scraped counts, not asked of Claude —
    // it's the share of their recent content that is replies to other people.
    let replyFreq = null;
    if (repliesLoaded) {
      if (replies.length === 0) replyFreq = "Never";
      else if (postsLoaded) {
        const share = replies.length / (posts.length + replies.length);
        replyFreq = share < 0.15 ? "Rarely"
                  : share < 0.35 ? "Occasionally"
                  : share < 0.65 ? "Frequently"
                  : "Constantly";
      }
    }

    area.innerHTML = `<p class="tof-loading">Analyzing…</p>`;
    const retry = () => doAnalysis(resp);
    // If the service worker gets killed mid-request, the callback below never
    // fires at all — this timer is the only thing standing between the user
    // and an eternal "Analyzing…".
    const stallTimer = setTimeout(() => {
      showAnalysisError("Analysis stalled — the background request never came back.", retry);
    }, 45000);
    try {
      chrome.runtime.sendMessage({
        type: "ANALYZE_PROFILE",
        force: forceAnalysis,
        profileData: { username, ...profileData, posts, replies, postsLoaded, repliesLoaded, notFound, externalUrl: profileData.externalUrl ?? null },
      }, (r) => {
        clearTimeout(stallTimer);
        if (chrome.runtime.lastError || !r?.success) {
          showAnalysisError(r?.error ?? "Analysis failed — the background worker may have restarted.", retry);
          return;
        }
        const area2 = document.getElementById("tof-analysis-area");
        if (area2) renderAnalysis(r.result, area2, replyFreq);
      });
    } catch (e) {
      clearTimeout(stallTimer);
      showAnalysisError(e.message, retry);
    }
  }

  onPostsReady(postsEntry, doAnalysis);
}

// Refresh link: clear every cache layer for this user and redo the whole pipeline
function refreshProfile(username) {
  const content = document.getElementById("tof-panel-content");
  if (content) content.innerHTML = `<p class="tof-loading">Refreshing @${username}…</p>`;
  try {
    chrome.runtime.sendMessage({ type: "FETCH_PROFILE", username, force: true }, (resp) => {
      const d = (!chrome.runtime.lastError && resp?.success) ? resp.data : {};
      openSidePanel(username, d, ensurePostsFetch(username, true), true);
    });
  } catch (e) {
    if (content) content.innerHTML = `<p class="tof-error">${e.message}</p>`;
  }
}

// Trait coloring — keep in sync with TRAIT_VOCAB categories in background.js
const TRAITS_POSITIVE = new Set(["kind", "supportive", "funny", "witty", "insightful", "curious", "generous", "welcoming", "thoughtful", "playful", "knowledgeable", "creative", "earnest", "upbeat", "helpful"]);
const TRAITS_NEGATIVE = new Set(["angry", "combative", "snarky", "dismissive", "inflammatory", "spammy", "self-absorbed", "trollish", "bitter", "condescending", "crude"]);

function renderAnalysis(r, container, replyFreq) {
  const verdictEmoji = { genuine: "🟢", mixed: "🟡", suspicious: "🔴" };
  const emoji  = verdictEmoji[r.verdict] ?? "⚪";
  const traits = (r.traits ?? []).map(t => {
    const cls = TRAITS_POSITIVE.has(t) ? "tof-trait-pos"
              : TRAITS_NEGATIVE.has(t) ? "tof-trait-neg"
              : "tof-trait-neu";
    return `<span class="tof-trait ${cls}">${t}</span>`;
  }).join("");
  const flags     = (r.flags     ?? []).map(f => `<li>⚠️ ${f}</li>`).join("");
  const positives = (r.positives ?? []).map(p => `<li>✓ ${p}</li>`).join("");
  const topics    = (r.topics    ?? []).join(" · ");

  // "Replies: Frequently, warmly, and supportively" — frequency from data, style from
  // Claude. Claude may return its own conjunction ("warmly and supportively"), so split
  // it into parts and rejoin everything as one list to avoid "and X and Y" stacking.
  const style = (r.replyStyle ?? "").trim().replace(/^and\s+/i, "");
  let repliesLine = "";
  if (replyFreq === "Never") {
    repliesLine = "Never";
  } else {
    const parts = [
      replyFreq,
      ...(style ? style.split(/,\s*(?:and\s+)?|\s+and\s+/i) : []),
    ].filter(Boolean);
    if (parts.length === 1)      repliesLine = parts[0];
    else if (parts.length === 2) repliesLine = `${parts[0]} and ${parts[1]}`;
    else if (parts.length > 2)   repliesLine = `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  }

  container.innerHTML = `
    <div class="tof-verdict">${emoji} <strong>${r.verdict}</strong> · <em>${r.tone ?? ""}</em></div>
    ${traits      ? `<div class="tof-traits">${traits}</div>`                                : ""}
    <div class="tof-summary">${r.summary ?? ""}</div>
    ${repliesLine ? `<div class="tof-replies-line">↩ Replies: <strong>${repliesLine}</strong></div>` : ""}
    ${topics      ? `<div class="tof-topics">${topics}</div>`                                : ""}
    ${flags       ? `<ul class="tof-list tof-flags">${flags}</ul>`                           : ""}
    ${positives   ? `<ul class="tof-list tof-positives">${positives}</ul>`                   : ""}
  `;
}

// --- Helpers ---

function extractUsernameFromCard(card) {
  const links = card.querySelectorAll("a[href]");
  for (const link of links) {
    const m = link.href.match(/threads\.com\/@?([A-Za-z0-9_.]+)/);
    if (m) return m[1];
  }
  return null;
}

function extractFollowersFromCard(card) {
  const text = card.textContent || "";
  const m = text.match(/([\d][.\d]*[KMBkmb]?)\s+followers/i);
  return m ? m[1] : null;
}

// --- Hover card detection ---

let activeCard   = null;
let hideTimer    = null;
let preloadTimer = null; // debounce before opening background tabs for a hovered profile
let hoverGen     = 0;    // invalidates stale retry timers when a newer hover supersedes them
let lastMouseX   = -1;
let lastMouseY   = -1;
let safeZoneRect = null; // pixel bounds covering the trigger card + our panel, set in showPanel()

function inSafeZone(x, y) {
  return !!safeZoneRect &&
    x >= safeZoneRect.left && x <= safeZoneRect.right &&
    y >= safeZoneRect.top  && y <= safeZoneRect.bottom;
}

// Threads sometimes hasn't rendered the profile link into the card yet when it
// first un-hides; retry a few times before giving up on that hover.
function tryShowForCard(el, gen, attemptsLeft) {
  setTimeout(() => {
    if (gen !== hoverGen) return;                              // a newer hover took over
    if (el.hasAttribute("hidden") || !document.contains(el)) return; // card closed/removed already
    const hasProfileLink = !!el.querySelector('a[href*="/@"]');
    if (hasProfileLink) {
      activeCard = el;
      showPanel(el);
    } else if (attemptsLeft > 1) {
      tryShowForCard(el, gen, attemptsLeft - 1);
    }
  }, 150);
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.attributeName !== "hidden") continue;
    const el = mutation.target;
    if (el.hasAttribute("hidden")) {
      // Threads closed this card itself — if it's the one we're showing stats for, follow suit,
      // UNLESS the mouse is still within the trigger-card/panel safe zone (e.g. heading for Analyze).
      if (el === activeCard && !inSafeZone(lastMouseX, lastMouseY)) {
        hidePanel();
        activeCard = null;
      }
      continue;
    }
    tryShowForCard(el, ++hoverGen, 3);
  }
});

document.addEventListener("mousemove", (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  const panel = document.getElementById(TOF_PANEL_ID);
  if (!panel || !panel.classList.contains("tof-visible")) return;
  if (inSafeZone(e.clientX, e.clientY)) {
    clearTimeout(hideTimer);
  } else {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { hidePanel(); activeCard = null; }, 400);
  }
});

// Mouse left the browser window entirely — mousemove won't fire again to trigger the hide timer.
document.addEventListener("mouseout", (e) => {
  if (e.relatedTarget) return;
  hidePanel();
  activeCard = null;
  clearTimeout(hideTimer);
});

// The panel scrolls with the page but the safe zone is viewport-relative, so it goes
// stale on scroll — just hide, matching how Threads treats its own hover card.
window.addEventListener("scroll", () => {
  const panel = document.getElementById(TOF_PANEL_ID);
  if (panel && panel.classList.contains("tof-visible")) {
    hidePanel();
    activeCard = null;
    clearTimeout(hideTimer);
  }
}, { passive: true });

observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden"] });

console.log("[ToF] loaded");
