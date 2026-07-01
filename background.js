// background.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "FETCH_PROFILE") {
    cachedFetch(`tof_c_profile_${request.username}`, request.force,
      () => fetchProfileData(request.username))
      .then(({ data, fetchedAt }) => sendResponse({ success: true, data: { ...data, fetchedAt } }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.type === "FETCH_POSTS") {
    cachedFetch(`tof_c_posts_${request.username}`, request.force,
      () => withFetchSlot(() => fetchPostsAndReplies(request.username)),
      (result) => result.postsLoaded || result.repliesLoaded) // don't cache total failures
      .then(({ data }) => sendResponse({ success: true, ...data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (request.type === "ANALYZE_PROFILE") {
    cachedFetch(`tof_c_analysis_${request.profileData.username}`, request.force,
      () => analyzeProfile(request.profileData),
      // an analysis of incomplete data shouldn't be frozen for the full TTL
      () => request.profileData.postsLoaded || request.profileData.repliesLoaded)
      .then(({ data }) => sendResponse({ success: true, result: data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// --- Persistent cache (chrome.storage.local) ---
// Re-hovering someone within the TTL costs zero tabs and zero API tokens.

const CACHE_TTL_MS      = 12 * 60 * 60 * 1000;
const CACHE_PREFIX      = "tof_c_";
const CACHE_MAX_ENTRIES = 150;

async function cachedFetch(key, force, producer, shouldCache = () => true) {
  if (!force) {
    const stored = (await chrome.storage.local.get(key))[key];
    if (stored && Date.now() - stored.ts < CACHE_TTL_MS) {
      return { data: stored.data, fetchedAt: stored.ts };
    }
  }
  const data = await producer();
  const ts = Date.now();
  if (shouldCache(data)) {
    await chrome.storage.local.set({ [key]: { ts, data } });
    pruneCache();
  }
  return { data, fetchedAt: ts };
}

async function pruneCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const entries = Object.entries(all).filter(([k]) => k.startsWith(CACHE_PREFIX));
    const expiredKeys = entries.filter(([, v]) => Date.now() - v.ts >= CACHE_TTL_MS).map(([k]) => k);
    if (expiredKeys.length) await chrome.storage.local.remove(expiredKeys);
    const live = entries.filter(([k]) => !expiredKeys.includes(k));
    if (live.length > CACHE_MAX_ENTRIES) {
      const oldest = live.sort((a, b) => a[1].ts - b[1].ts)
        .slice(0, live.length - CACHE_MAX_ENTRIES).map(([k]) => k);
      await chrome.storage.local.remove(oldest);
    }
  } catch (e) { /* best-effort */ }
}

// --- Concurrency cap: each posts+replies fetch opens two tabs, so limit in-flight fetches ---

let fetchSlots = 2;
const fetchWaiters = [];

async function withFetchSlot(fn) {
  if (fetchSlots > 0) fetchSlots--;
  else await new Promise(resolve => fetchWaiters.push(resolve));
  try {
    return await fn();
  } finally {
    const next = fetchWaiters.shift();
    if (next) next(); else fetchSlots++;
  }
}

// Curated trait vocabulary — content.js colors these by category, so keep the two in sync
const TRAITS_POSITIVE = ["kind", "supportive", "funny", "witty", "insightful", "curious", "generous", "welcoming", "thoughtful", "playful", "knowledgeable", "creative", "earnest", "upbeat", "helpful"];
const TRAITS_NEUTRAL  = ["geeky", "political", "promotional", "opinionated", "prolific", "reserved", "niche", "quirky", "intense", "artsy"];
const TRAITS_NEGATIVE = ["angry", "combative", "snarky", "dismissive", "inflammatory", "spammy", "self-absorbed", "trollish", "bitter", "condescending", "crude"];
const TRAIT_VOCAB = [...TRAITS_POSITIVE, ...TRAITS_NEUTRAL, ...TRAITS_NEGATIVE];

const VERDICT_TOOL = {
  name: "report_verdict",
  description: "Report the structured assessment of this Threads profile.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["genuine", "mixed", "suspicious"] },
      summary: { type: "string", description: "One natural sentence describing what they recently wrote about." },
      tone:    { type: "string", description: "One word, e.g. earnest, snarky, angry, calm, funny, inflammatory." },
      traits:  {
        type: "array", items: { type: "string", enum: TRAIT_VOCAB }, minItems: 2, maxItems: 5,
        description: "2-5 adjectives that best capture this person's vibe. Include negative ones when warranted — don't sugarcoat."
      },
      topics:    { type: "array", items: { type: "string" }, maxItems: 3, description: "Up to 3 main topics as short phrases." },
      replyStyle: { type: "string", description: "How they conduct themselves in their replies to others, as a short adverbial phrase (1-3 words) that completes 'replies frequently and ___' — e.g. 'supportively', 'with dry humor', 'combatively', 'informatively'. Empty string if there are no replies to judge." },
      flags:     { type: "array", items: { type: "string" }, description: "Red flags — empty if none." },
      positives: { type: "array", items: { type: "string" }, description: "Good signals — empty if none." }
    },
    required: ["verdict", "summary", "tone", "traits", "topics", "replyStyle", "flags", "positives"]
  }
};

async function analyzeProfile({ username, bio, externalUrl, followers, following, ratio, threadCount, isVerified, posts, replies, postsLoaded, repliesLoaded, notFound }) {
  const { anthropicApiKey } = await chrome.storage.local.get("anthropicApiKey");
  if (!anthropicApiKey) throw new Error("No API key saved — open the extension settings to add one.");

  const now = Date.now() / 1000;

  function age(takenAt) {
    if (!takenAt) return "";
    const days = Math.round((now - takenAt) / 86400);
    if (days === 0) return " (today)";
    if (days === 1) return " (yesterday)";
    if (days < 30) return ` (${days}d ago)`;
    if (days < 365) return ` (${Math.round(days/30)}mo ago)`;
    return ` (${Math.round(days/365)}yr ago)`;
  }

  // Compute last active date across posts + replies
  const allTimestamps = [...posts, ...replies].map(p => p.takenAt).filter(Boolean);
  const lastActiveSecs = allTimestamps.length ? Math.max(...allTimestamps) : null;
  const lastActiveStr = lastActiveSecs ? age(lastActiveSecs).replace(/[()]/g, "").trim() : "unknown";
  const daysSinceActive = lastActiveSecs ? Math.round((now - lastActiveSecs) / 86400) : null;

  const postLines = !postsLoaded
    ? "Unable to load (do not draw conclusions about posting activity)."
    : posts.length
      ? posts.map((p, i) => `[post ${i+1}]${age(p.takenAt)} ${p.replyCount != null ? `(${p.replyCount} replies) ` : ""}${p.text}`).join("\n")
      : "None found.";

  const replyLines = !repliesLoaded
    ? "Unable to load (do not draw conclusions about whether they reply to others)."
    : replies.length
      ? replies.map((p, i) => `[reply ${i+1}]${age(p.takenAt)} ${p.text}`).join("\n")
      : "NONE — confirmed: this person has never replied to anyone else.";

  const inactivityNote = daysSinceActive !== null && daysSinceActive > 30
    ? `⚠️ INACTIVE: Last post was ${lastActiveStr} ago (${daysSinceActive} days). This MUST appear as a flag.`
    : `Last active: ${lastActiveStr}.`;

  const notFoundNote = notFound
    ? `\n⚠️ NOT FOUND: The profile page returned Threads' not-found error — the account may be deleted, suspended, or renamed. This MUST appear as a flag.`
    : "";

  const prompt = `You are helping a Threads.com user decide if someone is worth engaging with. Be concise and direct.

PROFILE: @${username}${isVerified ? " ✓" : ""}
Bio: ${bio || "(none)"}${externalUrl ? `\nWebsite: ${externalUrl}` : ""}
Followers: ${followers?.toLocaleString() ?? "unknown"} | Following: ${following?.toLocaleString() ?? "unknown"} | Ratio: ${ratio ? ratio + "x" : "unknown"}
Total threads posted: ${threadCount ?? "unknown"}
${inactivityNote}${notFoundNote}

RECENT POSTS:
${postLines}

THEIR REPLIES TO OTHERS:
${replyLines}

Rules:
- If last active > 30 days ago, that MUST be in flags.
- If replies says "NONE — confirmed", that MUST be in flags.
- If data says "Unable to load", do NOT flag or comment on it — you have no evidence.
- If following >> followers (ratio below 0.1x), flag it.
- Keep summary focused on content topics, not activity level.
- replyStyle must be judged ONLY from their replies to others (never from their posts); use an empty string if replies are unavailable or none exist.

Report your assessment by calling the report_verdict tool.`;

  const res = await anthropicFetch(anthropicApiKey, {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    tools: [VERDICT_TOOL],
    tool_choice: { type: "tool", name: "report_verdict" },
    messages: [{ role: "user", content: prompt }],
  });

  const json = await res.json();
  const block = (json.content ?? []).find(b => b.type === "tool_use");
  if (!block?.input?.verdict) throw new Error("Claude returned an unexpected response shape.");
  return block.input;
}

// One retry on rate-limit/server errors OR stalled connections, then give up
// with a readable message. Without the per-attempt timeout a dropped socket
// hangs the whole analysis forever ("Analyzing…" limbo).
async function anthropicFetch(apiKey, body) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 2000)); continue; }
      throw new Error(e.name === "TimeoutError"
        ? "Claude API request timed out twice — check your connection and try again."
        : `Claude API request failed: ${e.message}`);
    }
    if (res.ok) return res;
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err.slice(0, 200)}`);
  }
}

async function fetchPostsAndReplies(username) {
  const timeout = new Promise(resolve =>
    setTimeout(() => resolve({ posts: [], replies: [], postsLoaded: false, repliesLoaded: false, timedOut: true }), 25000)
  );
  const fetches = Promise.all([
    fetchPostsViaTab(`https://www.threads.com/@${username}`),
    fetchPostsViaTab(`https://www.threads.com/@${username}/replies`),
  ]).then(([posts, replies]) => {
    const notFound = posts === "NOT_FOUND" || replies === "NOT_FOUND";
    if (!Array.isArray(posts))   posts   = null;
    if (!Array.isArray(replies)) replies = null;
    return {
      posts:         posts   ?? [],
      replies:       replies ?? [],
      postsLoaded:   posts   !== null,
      repliesLoaded: replies !== null,
      notFound,
    };
  });
  return Promise.race([fetches, timeout]);
}

async function fetchPostsViaTab(url) {
  return new Promise((resolve) => {
    let tabId    = null;
    let settled  = false;
    let onUpdatedFn, onRemovedFn;

    function done(val) {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      try { if (onUpdatedFn) chrome.tabs.onUpdated.removeListener(onUpdatedFn); } catch(e){}
      try { if (onRemovedFn) chrome.tabs.onRemoved.removeListener(onRemovedFn); } catch(e){}
      if (tabId != null) { try { chrome.tabs.remove(tabId, () => {}); } catch(e){} }
      resolve(val);
    }

    const safetyTimer = setTimeout(() => done(null), 22000);

    function tryExtract(n) {
      if (n <= 0) { done(null); return; }
      chrome.scripting.executeScript({ target: { tabId }, func: scrapePostsFromPage }, (res) => {
        if (chrome.runtime.lastError) { setTimeout(() => tryExtract(n - 1), 1000); return; }
        const r = res?.[0]?.result ?? null;
        if (r === null) { setTimeout(() => tryExtract(n - 1), 1500); }        // still loading
        else if (r === "NOT_FOUND") { done("NOT_FOUND"); }                    // 404 page — real signal
        else { done(Array.isArray(r) ? r : null); }                           // [] = loaded, zero posts
      });
    }

    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab) { done(null); return; }
      tabId = tab.id;

      onRemovedFn = (rid) => { if (rid === tabId) done(null); };
      chrome.tabs.onRemoved.addListener(onRemovedFn);

      onUpdatedFn = (uid, info) => {
        if (uid !== tabId || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdatedFn); onUpdatedFn = null;
        setTimeout(() => tryExtract(5), 2000);
      };
      chrome.tabs.onUpdated.addListener(onUpdatedFn);
    });
  });
}

// Runs inside the profile/replies tab — must be self-contained (no closure variables)
function scrapePostsFromPage() {
  // Detect Threads 404 error page immediately so the tab closes fast
  const bodyText = document.body?.innerText || '';
  if (bodyText.includes("link's not working") || bodyText.includes("page is gone")) {
    return 'NOT_FOUND';
  }

  const html = document.documentElement.innerHTML;
  if (!html.includes('"thread_items"')) return null; // still loading

  // Use the URL path to identify the page owner — works reliably on both /user and /user/replies
  // Matching by username avoids ambiguity between user pk and post pk in the JSON
  const pageUsername = location.pathname.split('/')[1]?.replace('@', '').toLowerCase();

  const posts = [];
  const seenPks = new Set();
  const re = /"thread_items"\s*:\s*\[/g;
  let m;

  while ((m = re.exec(html)) !== null) {
    const start = m.index + m[0].length - 1;
    let depth = 0, end = -1;
    for (let i = start; i < Math.min(html.length, start + 80000); i++) {
      if (html[i] === "[") depth++;
      else if (html[i] === "]") { if (--depth === 0) { end = i; break; } }
    }
    if (end === -1) continue;
    try {
      const items = JSON.parse(html.slice(start, end + 1));
      for (const item of items) {
        const post = item.post;
        if (!post?.pk || seenPks.has(post.pk)) continue;
        if (pageUsername) {
          const postUsername = (post.user?.username ?? "").toLowerCase();
          if (postUsername !== pageUsername) continue;
        }
        seenPks.add(post.pk);
        const text = (
          post.caption?.text ||
          (post.text_fragments?.fragments ?? []).map(f => f.plaintext ?? "").join("")
        ).trim();
        if (!text) continue;
        const tpai = post.text_post_app_info ?? {};
        posts.push({
          text,
          takenAt:     post.taken_at            ?? null,
          replyCount:  tpai.direct_reply_count  ?? null,
          repostCount: tpai.repost_count        ?? null,
          quoteCount:  tpai.quote_count         ?? null,
        });
      }
    } catch (e) {}
  }
  return posts; // [] means "loaded but no posts found" — still stops polling
}

async function fetchProfileData(username) {
  const profileRes = await fetch(
    `https://www.threads.com/@${username}`,
    { credentials: "include" }
  );
  if (!profileRes.ok) throw new Error(`Profile page HTTP ${profileRes.status}`);

  const profileHtml = await profileRes.text();
  const stats = parseProfileStats(profileHtml, username);

  const userId = extractUserId(profileHtml);
  if (userId) await fetchUserInfo(userId, stats);

  return stats;
}

async function fetchUserInfo(userId, stats) {
  try {
    const res = await fetch(
      `https://www.threads.com/api/v1/users/${userId}/info/`,
      { credentials: "include", headers: { "X-IG-App-ID": "238260118697367" } }
    );
    if (!res.ok) return;
    const json = await res.json();
    const user = json.user || json;
    if (user.following_count != null) stats.following = user.following_count;
    if (user.follower_count  != null) stats.followers  = user.follower_count;
    if (stats.followers != null && stats.following != null && stats.following > 0) {
      stats.ratio = (stats.followers / stats.following).toFixed(1);
    }
    const url = user.external_url || user.bio_links?.[0]?.url || null;
    if (url) stats.externalUrl = url;
  } catch (e) { /* non-fatal */ }
}


function parseProfileStats(html, username) {
  const stats = {
    username,
    threadCount: null,
    isVerified:  null,
    bio:         null,
    profileUrl:  `https://www.threads.com/@${username}`
  };

  // og:description: "54.3K Followers • 1.1K Threads • Bio text here..."
  const ogDesc = (
    html.match(/property="og:description"\s+content="([^"]+)"/) ||
    html.match(/content="([^"]+)"\s+property="og:description"/)
  )?.[1];

  if (ogDesc) {
    const decoded = ogDesc.replace(/&#x2022;/g, "•").replace(/&#x[\da-f]+;/gi, c =>
      String.fromCharCode(parseInt(c.slice(3,-1), 16)));
    const threadMatch = decoded.match(/([\d][.\d]*[KMBkmb]?)\s+Threads/i);
    if (threadMatch) stats.threadCount = threadMatch[1];
    // Bio is everything after the "Threads •" portion; strip Threads' boilerplate fallback
    const bioMatch = decoded.match(/Threads\s*•\s*([\s\S]+)/i);
    if (bioMatch) {
      let bio = bioMatch[1];
      const boilerplateIdx = bio.indexOf('See the latest conversations');
      if (boilerplateIdx !== -1) bio = bio.slice(0, boilerplateIdx);
      bio = bio.trim();
      if (bio) stats.bio = bio;
    }
  }

  const verifiedMatch = html.match(/"is_verified"\s*:\s*(true|false)/);
  if (verifiedMatch) stats.isVerified = verifiedMatch[1] === "true";

  return stats;
}

function extractUserId(html) {
  for (const pattern of [
    /"user_id"\s*:\s*"(\d+)"/,
    /"pk"\s*:\s*"(\d+)"/,
    /"pk"\s*:\s*(\d+)/,
    /"owner"\s*:\s*\{[^}]*"id"\s*:\s*"(\d+)"/,
  ]) {
    const m = html.match(pattern);
    if (m) return m[1];
  }
  return null;
}

