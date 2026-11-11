// Project board: the sales.sunnn.co Action Items board inside Buzz.
// Each person connects their own "Project board only" key once per computer;
// the board then reads and edits as them (drag cards, add, edit, comment).
// Styling uses Buzz design tokens so it follows the app's theme and text size.

export const inject = ["react", "pages", "host", "navigation"];

const SALES = "https://sales.sunnn.co/action-items";
const REFRESH_MS = 30000;
const DAY = 86400000;

// Survives page remounts (and disable/enable) within one app session.
const memory = { boardId: null, collapsed: {}, filter: "all", order: "board" };

const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/></svg>',
  );

// ---------- theme helpers (Buzz tokens with safe fallbacks) ----------
const T = {
  text: "var(--text-standard, inherit)",
  subtle: "var(--text-subtle, color-mix(in srgb, currentColor 72%, transparent))",
  meta: "var(--text-metadata, color-mix(in srgb, currentColor 58%, transparent))",
  panel: "var(--surface-panel, color-mix(in srgb, currentColor 6%, transparent))",
  inset: "var(--surface-inset, color-mix(in srgb, currentColor 4%, transparent))",
  border: "var(--border-standard, color-mix(in srgb, currentColor 14%, transparent))",
  strong: "var(--border-prominent, color-mix(in srgb, currentColor 35%, transparent))",
  focus: "var(--border-focus, currentColor)",
  danger: "var(--text-danger, #e5484d)",
  warning: "var(--text-warning, #d49b00)",
  success: "var(--text-success, #30a46c)",
};
const tint = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

const LABEL_COLORS = {
  green: "#30a46c", yellow: "#d49b00", orange: "#f76b15", red: "#e5484d",
  purple: "#8e4ec6", blue: "#0090ff", sky: "#00a2c7", lime: "#5bb98b",
  pink: "#d6409f", black: "#8b8d98",
};
function labelColor(c) {
  if (!c) return LABEL_COLORS.black;
  if (c.startsWith("#")) return c;
  return LABEL_COLORS[c.toLowerCase()] || LABEL_COLORS.black;
}

function listTone(title) {
  const t = String(title || "").toLowerCase();
  if (/urgent/.test(t)) return "#e5484d";
  if (/^priority|high level|priority$/.test(t)) return "#f5a524";
  if (/complete|done/.test(t)) return "#30a46c";
  if (/backlog/.test(t)) return T.strong;
  return "var(--text-subtle, #8b8d98)";
}

// "URGENT PRIORITY" -> "Urgent Priority"; mixed-case titles stay as written.
function niceTitle(s) {
  const str = String(s || "");
  if (str !== str.toUpperCase()) return str;
  return str.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
}

const isDoneList = (title) => /^(completed?|done)$/i.test(String(title || "").trim());

function personName(email) {
  if (!email) return "";
  // Buzz-mirrored comments record an agent reply by its short event id.
  if (!String(email).includes("@")) return /^[a-f0-9]{6,64}$/i.test(String(email)) ? "Agent" : String(email);
  const local = String(email).split("@")[0];
  if (local === "buzz") return "Buzz";
  return local.split(/[._-]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function dueInfo(card) {
  const raw = card.dueAt || card.dueDate;
  if (!raw) return null;
  const d = new Date(card.dueAt ? raw : raw + "T17:00:00");
  if (isNaN(d)) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDiff = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startToday) / DAY);
  let text;
  if (d < now) text = dayDiff === 0 ? "Due today" : "Overdue · " + d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  else if (dayDiff === 0) text = "Due today";
  else if (dayDiff === 1) text = "Due tomorrow";
  else if (dayDiff < 7) text = "Due " + d.toLocaleDateString(undefined, { weekday: "short" });
  else text = "Due " + d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const tone = d < now ? "overdue" : dayDiff <= 1 ? "soon" : dayDiff < 7 ? "week" : "later";
  return { text, tone, date: d };
}

function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  if (s < 86400 * 30) return Math.round(s / 86400) + "d ago";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ---------- text helpers ----------
const BUZZ_LINK = /buzz:\/\/message\?[^\s)\]]+/;
const NOISE_LINE = /^(open in buzz:|open this message:|summary written by ai|every message is listed in activity)/i;

function buzzTarget(text) {
  const m = String(text || "").match(BUZZ_LINK);
  if (!m) return null;
  try {
    const u = new URL(m[0].replace("buzz://message?", "https://x/?"));
    const channel = u.searchParams.get("channel");
    const id = u.searchParams.get("id");
    if (!channel || !/^[a-f0-9]{64}$/i.test(id || "")) return null;
    return { channel, id, thread: u.searchParams.get("thread") || null };
  } catch {
    return null;
  }
}

function cleanLines(text) {
  return String(text || "")
    .split("\n")
    .filter((l) => !NOISE_LINE.test(l.trim()));
}

function preview(text) {
  const lines = cleanLines(text).map((l) => l.trim()).filter(Boolean);
  const ask = lines.find((l) => /^ask:/i.test(l));
  const pick = ask ? ask.replace(/^ask:\s*/i, "") : lines[0] || "";
  return pick.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*/g, "").slice(0, 220);
}

// Comments mirrored from Buzz start with "<name or event id> · #channel · <time>".
function splitCommentHeader(body) {
  const text = String(body || "");
  const nl = text.indexOf("\n");
  const first = (nl === -1 ? text : text.slice(0, nl)).trim();
  const m = first.match(/^(.{1,80}?) · (#[\w.-]+) · (.+)$/);
  if (!m) return { who: null, where: null, text };
  const who = /^[a-f0-9]{8}$/i.test(m[1]) ? "Agent" : m[1];
  return { who, where: m[2], text: nl === -1 ? "" : text.slice(nl + 1).replace(/^\s+/, "") };
}

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const { useEffect, useMemo, useState, useCallback, useRef } = React;

  // ---------- sales.sunnn.co API, as the person whose board key this is ----------
  // Each person connects their own "Project board only" key (crm.sunnn.co
  // Settings > API). It is kept on this device only, in the app's local
  // storage, and the server lets it reach the Action Items board and nothing
  // else. Requests go through ctx.host.request (manifest.host.networkOrigins).
  const ORIGIN = "https://sales.sunnn.co";
  const KEY_STORE = "sunnn.project-board.key.v1";
  const KEY_SHAPE = /^sunnn_sk_[0-9A-Za-z]{40}$/;
  const keyListeners = new Set();

  function getKey() {
    try {
      return window.localStorage.getItem(KEY_STORE) || "";
    } catch {
      return "";
    }
  }
  function setKey(k) {
    try {
      if (k) window.localStorage.setItem(KEY_STORE, k);
      else window.localStorage.removeItem(KEY_STORE);
    } catch {
      /* storage unavailable: the key lives for this session only */
    }
    keyListeners.forEach((fn) => fn());
  }

  function bodyText(b) {
    if (b == null) return "";
    if (typeof b === "string") return b;
    try {
      return new TextDecoder().decode(b);
    } catch {
      return String(b);
    }
  }

  async function api(path, opts = {}, keyOverride) {
    const key = keyOverride || getKey();
    if (!key) {
      const e = new Error("Connect your board key first.");
      e.code = "nokey";
      throw e;
    }
    const headers = { authorization: "Bearer " + key, accept: "application/json" };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await ctx.host.request({
        url: ORIGIN + path,
        method: opts.method || "GET",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        timeoutMs: 20000,
      });
    } catch (err) {
      throw new Error("Couldn't reach sales.sunnn.co. Check your internet and try again.");
    }
    let data = null;
    const text = bodyText(res.body);
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.status === 401) {
      const e = new Error("Your board key wasn't accepted. It may have expired or been revoked. Connect a new one.");
      e.code = "auth";
      throw e;
    }
    if (res.status >= 400) throw new Error((data && data.error) || "sales.sunnn.co said " + res.status);
    return data;
  }

  const DONE_SHOWN = 25;
  async function read(req) {
    if (req.op === "boards") {
      const d = await api("/api/sales/action-items/boards");
      return { boards: ((d && d.boards) || []).filter((b) => !b.archivedAt) };
    }
    if (req.op === "board") {
      const d = await api("/api/sales/action-items?boardId=" + encodeURIComponent(req.boardId));
      const lists = (d && d.lists) || [];
      const done = new Set(lists.filter((l) => isDoneList(l.title)).map((l) => l.id));
      const live = ((d && d.cards) || []).filter((c) => !c.archivedAt);
      const totals = {};
      const keep = new Set();
      const recent = live
        .filter((c) => done.has(c.listId))
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
      recent.forEach((c) => {
        totals[c.listId] = (totals[c.listId] || 0) + 1;
        if (totals[c.listId] <= DONE_SHOWN) keep.add(c.id);
      });
      return { lists, cards: live.filter((c) => !done.has(c.listId) || keep.has(c.id)), totals };
    }
    if (req.op === "card") {
      const base = "/api/sales/action-items/cards/" + encodeURIComponent(req.id);
      const [checklists, comments] = await Promise.all([api(base + "/checklists"), api(base + "/comments")]);
      return { checklists, comments };
    }
    throw new Error("unknown read");
  }

  const write = {
    patchCard: (id, patch) => api("/api/sales/action-items/cards/" + encodeURIComponent(id), { method: "PATCH", body: patch }),
    archiveCard: (id) => api("/api/sales/action-items/cards/" + encodeURIComponent(id), { method: "DELETE" }),
    createCard: (body) => api("/api/sales/action-items/cards", { method: "POST", body }),
    reorder: (listId, positions) => api("/api/sales/action-items/cards/reorder", { method: "POST", body: { listId, positions } }),
    comment: (id, text) => api("/api/sales/action-items/cards/" + encodeURIComponent(id) + "/comments", { method: "POST", body: { body: text } }),
    viewed: (id, commentIds) =>
      api("/api/sales/action-items/cards/" + encodeURIComponent(id) + "/view", { method: "POST", body: { commentIds } }),
    toggleItem: (itemId, checked) => api("/api/sales/action-items/items/" + encodeURIComponent(itemId), { method: "PATCH", body: { checked } }),
    addItem: (checklistId, text) =>
      api("/api/sales/action-items/checklists/" + encodeURIComponent(checklistId) + "/items", { method: "POST", body: { text } }),
    addChecklist: (cardId, title) =>
      api("/api/sales/action-items/cards/" + encodeURIComponent(cardId) + "/checklists", { method: "POST", body: { title } }),
  };

  function useKey() {
    const [key, setK] = useState(getKey());
    useEffect(() => {
      const fn = () => setK(getKey());
      keyListeners.add(fn);
      return () => keyListeners.delete(fn);
    }, []);
    return key;
  }


  async function openBuzz(target) {
    const relay = ctx.reflect && ctx.reflect.get ? ctx.reflect.get("relay") : undefined;
    const snap = relay && relay.snapshot ? relay.snapshot() : null;
    if (!snap || !snap.viewer || !snap.origin) return { status: "failed" };
    try {
      return await ctx.navigation.open({
        version: 1,
        kind: "conversation",
        scope: { viewer: snap.viewer, communityOrigin: snap.origin },
        channelId: target.channel,
        messageId: target.id,
        ...(target.thread ? { threadRootId: target.thread } : {}),
      });
    } catch (e) {
      return { status: "failed" };
    }
  }

  // ---------- rich text: paragraphs, bullets, links, images, bold ----------
  function inline(str, keyBase) {
    const out = [];
    const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|\[([^\]]+)\]\(((?:https?|buzz):\/\/[^)\s]+)\)|((?:https?|buzz):\/\/[^\s)\]]+)|\*\*([^*]+)\*\*/g;
    let last = 0;
    let m;
    let i = 0;
    while ((m = re.exec(str))) {
      if (m.index > last) out.push(str.slice(last, m.index));
      const k = keyBase + "-" + i++;
      if (m[2]) {
        // Relay media needs a signed fetch, so show images as a link, not a broken <img>.
        out.push(h(Link, { key: k, href: m[2] }, "🖼 " + (m[1] || "Image")));
      } else if (m[4]) out.push(h(Link, { key: k, href: m[4] }, m[3]));
      else if (m[5]) out.push(h(Link, { key: k, href: m[5] }, shortUrl(m[5])));
      else if (m[6]) out.push(h("strong", { key: k }, m[6]));
      last = re.lastIndex;
    }
    if (last < str.length) out.push(str.slice(last));
    return out;
  }

  function shortUrl(u) {
    if (u.startsWith("buzz://")) return "Buzz message";
    try {
      const x = new URL(u);
      const tail = x.pathname.length > 24 ? x.pathname.slice(0, 22) + "…" : x.pathname;
      return x.hostname.replace(/^www\./, "") + (tail === "/" ? "" : tail);
    } catch {
      return u;
    }
  }

  function Link(props) {
    const href = props.href;
    if (href.startsWith("buzz://")) {
      const target = buzzTarget(href);
      return h(
        "button",
        {
          type: "button",
          onClick: () => target && openBuzz(target),
          style: { all: "unset", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 },
        },
        props.children,
      );
    }
    return h("a", { href, target: "_blank", rel: "noreferrer", style: { color: "inherit", textDecoration: "underline", textUnderlineOffset: 2, overflowWrap: "anywhere" } }, props.children);
  }

  function RichText(props) {
    const lines = cleanLines(props.text);
    const blocks = [];
    let para = [];
    const flush = () => {
      if (para.length) {
        blocks.push({ kind: "p", lines: para });
        para = [];
      }
    };
    lines.forEach((raw) => {
      const l = raw.trimEnd();
      if (!l.trim()) return flush();
      if (/^\s*[-*•]\s+/.test(l)) {
        flush();
        blocks.push({ kind: "li", text: l.replace(/^\s*[-*•]\s+/, "") });
        return;
      }
      const key = l.match(/^(Ask|Status|Next|ELI5|Why|Blocker|Owner|Result|Done|Note):\s*(.*)$/i);
      if (key) {
        flush();
        blocks.push({ kind: "kv", k: key[1], v: key[2] });
        return;
      }
      para.push(l.replace(/^#+\s*/, ""));
    });
    flush();
    return h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 8, fontSize: "0.94rem", lineHeight: 1.6, color: T.text } },
      blocks.map((b, i) => {
        if (b.kind === "li")
          return h("div", { key: i, style: { display: "flex", gap: 8, paddingLeft: 4 } }, h("span", { style: { color: T.meta } }, "•"), h("span", null, inline(b.text, "l" + i)));
        if (b.kind === "kv")
          return h(
            "div",
            { key: i, style: { display: "grid", gridTemplateColumns: "64px 1fr", gap: 8 } },
            h("span", { style: { fontSize: "0.72rem", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: T.meta, paddingTop: 3 } }, b.k),
            h("span", null, inline(b.v, "k" + i)),
          );
        return h("p", { key: i, style: { margin: 0, overflowWrap: "anywhere" } }, b.lines.map((ln, j) => [j ? h("br", { key: "br" + j }) : null, ...inline(ln, "p" + i + "-" + j)]));
      }),
    );
  }

  // ---------- small pieces ----------
  function Pill(props) {
    return h(
      "span",
      {
        title: props.title,
        style: {
          display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999,
          fontSize: "0.76rem", fontWeight: 600, lineHeight: 1.5, whiteSpace: "nowrap",
          color: props.color || T.subtle, background: props.bg || tint("currentColor", 8),
          border: props.outline ? "1px solid " + T.border : "1px solid transparent",
        },
      },
      props.dot ? h("span", { style: { width: 7, height: 7, borderRadius: 4, background: props.dot } }) : null,
      props.children,
    );
  }

  function DuePill(props) {
    const d = props.due;
    if (!d) return null;
    const map = {
      overdue: { color: "#fff", bg: "var(--surface-status-danger, #e5484d)" },
      soon: { color: T.warning, bg: tint(T.warning, 16) },
      week: { color: T.text, bg: tint("currentColor", 9) },
      later: { color: T.subtle, bg: tint("currentColor", 6) },
    };
    return h(Pill, { color: map[d.tone].color, bg: map[d.tone].bg, title: d.date.toLocaleString() }, "📅 " + d.text);
  }

  function Chip(props) {
    const active = props.active;
    return h(
      "button",
      {
        type: "button",
        onClick: props.onClick,
        "aria-pressed": active,
        style: {
          display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999,
          font: "inherit", fontSize: "0.84rem", fontWeight: active ? 650 : 500, cursor: "pointer",
          color: active ? "var(--text-inverse, #fff)" : T.text,
          background: active ? "var(--surface-inverse, #222)" : "transparent",
          border: "1px solid " + (active ? "transparent" : T.border),
        },
      },
      props.children,
      props.count != null
        ? h("span", { style: { fontSize: "0.74rem", opacity: 0.75, fontVariantNumeric: "tabular-nums" } }, props.count)
        : null,
    );
  }

  // ---------- comment ----------
  function Comment(props) {
    const m = props.comment;
    const parsed = splitCommentHeader(m.body);
    const [open, setOpen] = useState(false);
    const long = parsed.text.length > 520;
    const shown = long && !open ? parsed.text.slice(0, 480).replace(/\s+\S*$/, "") + "…" : parsed.text;
    const name = parsed.who || personName(m.authorEmail);
    return h(
      "article",
      { style: { padding: "12px 0", borderTop: "1px solid " + T.border } },
      h(
        "div",
        { style: { display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 6 } },
        h("strong", { style: { fontSize: "0.9rem" } }, name),
        parsed.where ? h("span", { style: { fontSize: "0.8rem", color: T.meta } }, "in " + parsed.where) : null,
        h("span", { style: { fontSize: "0.8rem", color: T.meta } }, ago(m.createdAt)),
      ),
      h(RichText, { text: shown }),
      long
        ? h("button", { type: "button", onClick: () => setOpen(!open), style: { marginTop: 6, fontSize: "0.82rem", padding: "2px 10px" } }, open ? "Show less" : "Show more")
        : null,
    );
  }

  // ---------- card tile ----------
  function CardTile(props) {
    const c = props.card;
    const due = dueInfo(c);
    const labels = Array.isArray(c.labels) ? c.labels : [];
    const hint = preview(c.description);
    const fresh = c.lastCommentAt && Date.now() - new Date(c.lastCommentAt).getTime() < DAY;
    const dragging = props.dragId === c.id;
    return h(
      "div",
      {
        role: "button",
        tabIndex: 0,
        draggable: !props.readOnly,
        "data-card-id": c.id,
        onDragStart: (e) => {
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", c.id); } catch { /* some hosts refuse custom data */ }
          props.onDragStart(c.id);
        },
        onDragEnd: props.onDragEnd,
        onClick: () => props.onOpen(c),
        onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpen(c); } },
        "aria-current": props.selected ? "true" : undefined,
        style: {
          display: "flex", flexDirection: "column", gap: 8, width: "100%", textAlign: "left",
          cursor: props.readOnly ? "pointer" : "grab", boxSizing: "border-box",
          padding: "12px 14px", borderRadius: 14, color: T.text, opacity: dragging ? 0.35 : 1,
          background: "var(--surface-base, " + T.panel + ")",
          border: "1px solid " + (props.selected ? T.focus : T.border),
          boxShadow: props.selected ? "0 0 0 1px " + T.focus : "var(--shadow-sm, none)",
          borderLeft: c.coverColor ? "4px solid " + labelColor(c.coverColor) : undefined,
          userSelect: "none",
        },
      },
      labels.length
        ? h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
            labels.map((l, i) => h(Pill, { key: i, dot: labelColor(l.color), bg: tint(labelColor(l.color), 12), color: T.subtle }, l.name || "Label")))
        : null,
      h("div", { style: { fontSize: "0.98rem", lineHeight: 1.4, fontWeight: 600, overflowWrap: "anywhere" } }, c.title),
      hint
        ? h("div", {
            style: { fontSize: "0.85rem", lineHeight: 1.45, color: T.subtle, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
          }, hint)
        : null,
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 } },
        h(DuePill, { due }),
        c.agentDoneAt ? h(Pill, { color: T.success, bg: tint(T.success, 14), title: "An agent marked this done " + ago(c.agentDoneAt) }, "✓ Agent done") : null,
        c.assignedTo ? h(Pill, { outline: true, title: c.assignedTo }, "👤 " + personName(c.assignedTo)) : null,
        h("span", { style: { flex: 1 } }),
        c.unreadCount
          ? h(Pill, { color: "var(--text-on-accent, #fff)", bg: "var(--accent-9, #0090ff)", title: "Comments you haven't opened" }, c.unreadCount + " new")
          : null,
        c.commentCount
          ? h("span", {
              title: c.lastCommentAt ? "Last comment " + ago(c.lastCommentAt) + (c.lastCommentBy ? " by " + personName(c.lastCommentBy) : "") : "Comments",
              style: { fontSize: "0.78rem", color: fresh ? T.text : T.meta, fontWeight: fresh ? 650 : 500, whiteSpace: "nowrap" },
            },
            "💬 " + c.commentCount + (c.lastCommentAt ? " · " + ago(c.lastCommentAt) : ""))
          : null,
      ),
    );
  }

  // ---------- add-card composer ----------
  function AddCard(props) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    const [busy, setBusy] = useState(false);
    if (!open)
      return h("button", {
        type: "button", onClick: () => setOpen(true),
        style: { margin: "2px 10px 12px", textAlign: "left", border: "1px dashed " + T.border, background: "transparent", color: T.subtle, borderRadius: 12, padding: "8px 12px" },
      }, "+ Add a card");
    const submit = async () => {
      const title = text.trim();
      if (!title) return setOpen(false);
      setBusy(true);
      const ok = await props.onAdd(title);
      setBusy(false);
      if (ok) setText("");
    };
    return h(
      "div",
      { style: { margin: "2px 10px 12px", display: "flex", flexDirection: "column", gap: 6 } },
      h("textarea", {
        autoFocus: true, rows: 2, value: text, placeholder: "What needs doing?", disabled: busy,
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
          if (e.key === "Escape") { setOpen(false); setText(""); }
        },
        style: { font: "inherit", fontSize: "0.92rem", padding: "8px 10px", borderRadius: 12, border: "1px solid " + T.strong, background: "var(--surface-base, transparent)", color: T.text, resize: "vertical" },
      }),
      h("div", { style: { display: "flex", gap: 6 } },
        h("button", { type: "button", onClick: () => void submit(), disabled: busy, style: { fontWeight: 650 } }, busy ? "Adding…" : "Add card"),
        h("button", { type: "button", onClick: () => { setOpen(false); setText(""); } }, "Cancel"),
      ),
    );
  }

  // ---------- column ----------
  function Column(props) {
    const { list, cards, total, collapsed } = props;
    const tone = listTone(list.title);
    const body = useRef(null);
    const [dropAt, setDropAt] = useState(null); // index among visible cards, or null
    const dragging = !!props.dragId;

    function indexFor(clientY) {
      const nodes = body.current ? Array.from(body.current.querySelectorAll("[data-card-id]")) : [];
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect();
        if (clientY < r.top + r.height / 2) return i;
      }
      return nodes.length;
    }
    const dropHandlers = props.readOnly
      ? {}
      : {
          onDragOver: (e) => {
            if (!props.dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const i = collapsed ? cards.length : indexFor(e.clientY);
            if (i !== dropAt) setDropAt(i);
          },
          onDragLeave: (e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setDropAt(null);
          },
          onDrop: (e) => {
            e.preventDefault();
            const i = dropAt == null ? cards.length : dropAt;
            setDropAt(null);
            const before = cards.filter((c) => c.id !== props.dragId)[i] || null;
            props.onDropCard(list.id, before ? before.id : null);
          },
        };

    if (collapsed) {
      return h(
        "button",
        {
          type: "button", onClick: props.onToggle, title: "Show " + niceTitle(list.title), ...dropHandlers,
          style: {
            flex: "0 0 48px", alignSelf: "stretch", maxHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center",
            gap: 10, padding: "14px 0", borderRadius: 18, cursor: "pointer", font: "inherit", color: T.text,
            background: dropAt != null ? tint(tone, 18) : T.inset, border: "1px solid " + (dropAt != null ? tone : T.border), borderTop: "3px solid " + tone,
          },
        },
        h("span", { style: { fontSize: "0.78rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" } }, total),
        h("span", { style: { writingMode: "vertical-rl", fontSize: "0.86rem", fontWeight: 650, whiteSpace: "nowrap" } }, niceTitle(list.title)),
      );
    }
    const visible = cards;
    const marker = h("div", { key: "__drop", style: { height: 4, borderRadius: 2, background: "var(--accent-9, #0090ff)", margin: "-3px 2px" } });
    const items = [];
    const draggedIdx = visible.findIndex((c) => c.id === props.dragId);
    visible.forEach((c, i) => {
      if (dragging && dropAt === i && i !== draggedIdx && i !== draggedIdx + 1) items.push(marker);
      items.push(h(CardTile, {
        key: c.id, card: c, onOpen: props.onOpen, selected: props.selectedId === c.id, readOnly: props.readOnly,
        dragId: props.dragId, onDragStart: props.onDragStart, onDragEnd: () => { setDropAt(null); props.onDragEnd(); },
      }));
    });
    if (dragging && dropAt === visible.length && draggedIdx !== visible.length - 1) items.push(marker);
    return h(
      "section",
      {
        "aria-label": niceTitle(list.title), "data-column": "1", ...dropHandlers,
        style: {
          flex: "0 0 300px", maxHeight: "100%", display: "flex", flexDirection: "column", borderRadius: 18,
          background: dragging && dropAt != null ? tint(tone, 8) : T.inset, border: "1px solid " + T.border, borderTop: "3px solid " + tone,
        },
      },
      h(
        "header",
        { style: { display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 8px 14px" } },
        h("h3", { style: { margin: 0, fontSize: "0.95rem", fontWeight: 700, flex: 1, lineHeight: 1.3 } }, niceTitle(list.title)),
        h(Pill, { title: total > cards.length ? "Showing the newest " + cards.length : undefined }, total > cards.length ? cards.length + " of " + total : String(cards.length)),
        h("button", { type: "button", onClick: props.onToggle, title: "Fold this column", "aria-label": "Fold " + niceTitle(list.title), style: { padding: "2px 8px", lineHeight: 1 } }, "‹"),
      ),
      h(
        "div",
        { ref: body, style: { overflowY: "auto", padding: "4px 10px 10px", display: "flex", flexDirection: "column", gap: 10, minHeight: 40 } },
        items.length
          ? items
          : h("p", { style: { color: T.meta, fontSize: "0.85rem", margin: "6px 4px 10px" } }, dragging ? "Drop here" : props.filtered ? "Nothing matches" : "No cards"),
      ),
      props.readOnly || props.filtered ? null : h(AddCard, { onAdd: (title) => props.onAdd(list.id, title) }),
    );
  }

  // ---------- connect ----------
  function Connect(props) {
    const [value, setValue] = useState("");
    const [state, setState] = useState(null);
    const save = async () => {
      const k = value.trim();
      if (!KEY_SHAPE.test(k)) return setState({ error: "That doesn't look like a key. It starts with sunnn_sk_ and is 49 characters long." });
      setState({ busy: true });
      try {
        const me = await api("/api/sales/me", {}, k);
        setKey(k);
        setValue("");
        setState({ ok: me && me.email });
        if (props.onDone) props.onDone();
      } catch (e) {
        setState({ error: e.code === "auth" ? "sales.sunnn.co didn't accept that key. Make a new one and try again." : String(e.message || e) });
      }
    };
    const step = (n, title, children) =>
      h("li", { style: { display: "grid", gridTemplateColumns: "28px 1fr", gap: 10, alignItems: "start" } },
        h("span", { style: { width: 26, height: 26, borderRadius: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "0.85rem", background: "var(--surface-inverse, #222)", color: "var(--text-inverse, #fff)" } }, n),
        h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, h("strong", { style: { fontSize: "1rem" } }, title), children));
    return h(
      "div",
      { style: { maxWidth: 560, margin: "40px auto", padding: "28px 30px", borderRadius: 24, background: "var(--surface-base, " + T.panel + ")", border: "1px solid " + T.border, display: "flex", flexDirection: "column", gap: 18, color: T.text } },
      h("h1", { style: { margin: 0, fontSize: "1.5rem" } }, "Connect your project board"),
      h("p", { style: { margin: 0, color: T.subtle, lineHeight: 1.55 } },
        props.reason || "One time on this computer. Your key lets this board move and edit cards as you, with your normal board access. It can't open contacts, messages or anything else."),
      h("ol", { style: { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 18 } },
        step(1, "Make a project board key", h("div", null,
          h("a", { href: "https://crm.sunnn.co/settings?newKey=board#api", target: "_blank", rel: "noreferrer", style: { fontWeight: 650, color: T.text } }, "Open crm.sunnn.co Settings ↗"),
          h("p", { style: { margin: "6px 0 0", color: T.subtle, fontSize: "0.9rem", lineHeight: 1.5 } }, "\"Project board only\" is already picked. Press Make key, then Copy."))),
        step(2, "Paste it here", h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          h("input", {
            type: "password", value, placeholder: "sunnn_sk_…", autoComplete: "off", spellCheck: false, "aria-label": "Board key",
            onChange: (e) => setValue(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") void save(); },
            style: { flex: "1 1 240px", padding: "9px 14px", borderRadius: 999, border: "1px solid " + T.strong, background: "transparent", color: T.text, font: "inherit" },
          }),
          h("button", { type: "button", onClick: () => void save(), disabled: state && state.busy, style: { fontWeight: 650, padding: "8px 18px" } }, state && state.busy ? "Checking…" : "Connect"),
        )),
      ),
      state && state.error ? h("p", { role: "alert", style: { margin: 0, color: T.danger } }, state.error) : null,
      h("p", { style: { margin: 0, color: T.meta, fontSize: "0.82rem", lineHeight: 1.5 } },
        "The key stays on this computer. To switch it off, revoke it in the same Settings page."),
    );
  }

  // ---------- editable bits ----------
  function EditableTitle(props) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(props.value);
    useEffect(() => setVal(props.value), [props.value]);
    const commit = () => {
      setEditing(false);
      const t = val.trim();
      if (t && t !== props.value) props.onSave(t);
      else setVal(props.value);
    };
    if (!editing)
      return h("h2", {
        title: "Click to rename", onClick: () => setEditing(true),
        style: { margin: 0, fontSize: "1.25rem", lineHeight: 1.35, flex: 1, overflowWrap: "anywhere", cursor: "text" },
      }, props.value);
    return h("textarea", {
      autoFocus: true, value: val, rows: 2, "aria-label": "Card title",
      onChange: (e) => setVal(e.target.value), onBlur: commit,
      onKeyDown: (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") { setVal(props.value); setEditing(false); } },
      style: { flex: 1, font: "inherit", fontSize: "1.2rem", fontWeight: 700, padding: "6px 10px", borderRadius: 12, border: "1px solid " + T.strong, background: "transparent", color: T.text, resize: "vertical" },
    });
  }

  function DescriptionEditor(props) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(props.value || "");
    useEffect(() => { if (!editing) setVal(props.value || ""); }, [props.value, editing]);
    if (!editing)
      return h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        props.value && cleanLines(props.value).join("").trim()
          ? h(RichText, { text: props.value })
          : h("p", { style: { color: T.meta, margin: 0 } }, "No description"),
        h("div", null, h("button", { type: "button", onClick: () => setEditing(true) }, props.value ? "Edit description" : "Add description")));
    return h("div", { style: { display: "flex", flexDirection: "column", gap: 6 } },
      h("textarea", {
        autoFocus: true, value: val, rows: Math.min(18, Math.max(5, val.split("\n").length + 1)), "aria-label": "Description",
        onChange: (e) => setVal(e.target.value),
        style: { font: "inherit", fontSize: "0.92rem", lineHeight: 1.55, padding: "10px 12px", borderRadius: 12, border: "1px solid " + T.strong, background: "transparent", color: T.text, resize: "vertical" },
      }),
      h("div", { style: { display: "flex", gap: 6 } },
        h("button", { type: "button", style: { fontWeight: 650 }, onClick: () => { setEditing(false); if (val !== (props.value || "")) props.onSave(val); } }, "Save"),
        h("button", { type: "button", onClick: () => { setEditing(false); setVal(props.value || ""); } }, "Cancel")));
  }

  // ---------- detail ----------
  function Detail(props) {
    const c = props.card;
    const [extra, setExtra] = useState(null);
    const [err, setErr] = useState(null);
    const [all, setAll] = useState(false);
    const [jump, setJump] = useState(null);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const [newItem, setNewItem] = useState({});
    const scroller = useRef(null);

    const loadExtra = useCallback(() => {
      let live = true;
      read({ op: "card", id: c.id })
        .then((d) => {
          if (!live) return;
          setExtra(d);
          const ids = ((d.comments && d.comments.comments) || []).map((m) => m.id);
          if (ids.length && c.unreadCount) write.viewed(c.id, ids).then(() => props.onSeen(c.id)).catch(() => undefined);
        })
        .catch((e) => live && setErr(String(e.message || e)));
      return () => { live = false; };
    }, [c.id]);

    useEffect(() => {
      setExtra(null);
      setErr(null);
      setAll(false);
      setJump(null);
      setDraft("");
      if (scroller.current) scroller.current.scrollTop = 0;
      return loadExtra();
    }, [c.id]);

    const lists = (extra && extra.checklists && extra.checklists.checklists) || [];
    const items = (extra && extra.checklists && extra.checklists.items) || [];
    const comments = (extra && extra.comments && extra.comments.comments) || [];
    const thread = buzzTarget(c.description);
    const due = dueInfo(c);
    const dueValue = c.dueDate ? String(c.dueDate).slice(0, 10) : c.dueAt ? new Date(c.dueAt).toISOString().slice(0, 10) : "";
    const sectionTitle = (t) => h("h3", { style: { margin: "4px 0 8px", fontSize: "0.78rem", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.meta } }, t);
    const row = (label, control) => [
      h("dt", { key: label + "k", style: { color: T.meta, alignSelf: "center" } }, label),
      h("dd", { key: label + "v", style: { margin: 0 } }, control),
    ];
    const selectStyle = { font: "inherit", fontSize: "0.9rem", padding: "4px 8px", borderRadius: 10, border: "1px solid " + T.border, background: "transparent", color: T.text, maxWidth: "100%" };

    async function toggleItem(it) {
      setExtra((x) => ({ ...x, checklists: { ...x.checklists, items: x.checklists.items.map((i) => (i.id === it.id ? { ...i, checked: !it.checked } : i)) } }));
      try { await write.toggleItem(it.id, !it.checked); } catch (e) { setErr(String(e.message || e)); loadExtra(); }
    }
    async function addItem(cl) {
      const text = (newItem[cl.id] || "").trim();
      if (!text) return;
      setNewItem((m) => ({ ...m, [cl.id]: "" }));
      try { await write.addItem(cl.id, text); loadExtra(); } catch (e) { setErr(String(e.message || e)); }
    }
    async function sendComment() {
      const text = draft.trim();
      if (!text) return;
      setSending(true);
      try {
        await write.comment(c.id, text);
        setDraft("");
        loadExtra();
        props.onCommented(c.id);
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        setSending(false);
      }
    }

    return h(
      "aside",
      {
        ref: scroller, "aria-label": "Card details",
        style: {
          flex: "0 1 460px", minWidth: 320, overflowY: "auto", padding: "20px 22px", borderRadius: 20,
          background: "var(--surface-base, " + T.panel + ")", border: "1px solid " + T.border,
          display: "flex", flexDirection: "column", gap: 16,
        },
      },
      h("div", { style: { display: "flex", alignItems: "flex-start", gap: 10 } },
        h(EditableTitle, { value: c.title, onSave: (title) => props.onPatch(c.id, { title }) }),
        h("button", { type: "button", onClick: props.onClose, "aria-label": "Close details", title: "Close (Esc)" }, "✕")),
      h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
        thread
          ? h("button", {
              type: "button", style: { fontWeight: 650 },
              onClick: async () => { setJump("opening"); const r = await openBuzz(thread); setJump(r && r.status === "opened" ? null : "failed"); },
            }, jump === "opening" ? "Opening…" : "💬 Open thread in Buzz")
          : null,
        props.doneListId && c.listId !== props.doneListId
          ? h("button", { type: "button", onClick: () => props.onMove(c.id, props.doneListId) }, "✓ Mark complete")
          : null,
        h("button", { type: "button", onClick: () => props.onArchive(c.id), title: "Hide this card from the board (you can restore it on sales.sunnn.co)" }, "Archive"),
        h("a", { href: SALES + "?board=" + props.boardId, target: "_blank", rel: "noreferrer", style: { fontSize: "0.86rem", color: T.subtle } }, "sales.sunnn.co ↗")),
      jump === "failed" ? h("p", { style: { margin: 0, color: T.danger, fontSize: "0.85rem" } }, "Couldn't open that thread here. It may be in a channel you haven't joined.") : null,
      h("dl", { style: { display: "grid", gridTemplateColumns: "88px 1fr", gap: "8px 12px", margin: 0, fontSize: "0.9rem" } },
        row("Column", h("select", { value: c.listId, onChange: (e) => props.onMove(c.id, e.target.value), style: selectStyle, "aria-label": "Column" },
          props.lists.map((l) => h("option", { key: l.id, value: l.id }, niceTitle(l.title))))),
        row("Due", h("span", { style: { display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
          h("input", { type: "date", value: dueValue, "aria-label": "Due date", onChange: (e) => props.onPatch(c.id, { dueDate: e.target.value || null }), style: selectStyle }),
          due ? h(DuePill, { due }) : null,
          dueValue ? h("button", { type: "button", onClick: () => props.onPatch(c.id, { dueDate: null }), style: { fontSize: "0.8rem", padding: "2px 8px" } }, "Clear") : null)),
        row("Assigned", h("select", {
          value: c.assignedTo || "", "aria-label": "Assigned to", style: selectStyle,
          onChange: (e) => props.onPatch(c.id, { assignedTo: e.target.value || null }),
        }, h("option", { value: "" }, "Nobody"), props.people.map((p) => h("option", { key: p, value: p }, personName(p))))),
        c.repName ? row("Rep", c.repName) : null,
        c.customerPrice ? row("Price", "$" + Number(c.customerPrice).toLocaleString()) : null,
        c.lastCommentAt ? row("Activity", ago(c.lastCommentAt) + (c.lastCommentBy ? " · " + personName(c.lastCommentBy) : "")) : null),
      h("section", null, sectionTitle("Description"),
        h(DescriptionEditor, { value: c.description, onSave: (description) => props.onPatch(c.id, { description }) })),
      err ? h("p", { role: "alert", style: { color: T.danger, margin: 0 } }, err) : null,
      !extra && !err ? h("p", { style: { color: T.meta, margin: 0 } }, "Loading checklists and comments…") : null,
      lists.map((cl) => {
        const mine = items.filter((i) => i.checklistId === cl.id);
        const done = mine.filter((i) => i.checked).length;
        const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
        return h("section", { key: cl.id },
          sectionTitle((cl.title || "Checklist") + " · " + done + "/" + mine.length),
          h("div", { style: { height: 6, borderRadius: 3, background: tint("currentColor", 10), marginBottom: 8 } },
            h("div", { style: { width: pct + "%", height: "100%", borderRadius: 3, background: pct === 100 ? T.success : "var(--accent-9, #0090ff)" } })),
          mine.map((i) =>
            h("label", { key: i.id, style: { display: "flex", gap: 10, fontSize: "0.92rem", padding: "3px 0", lineHeight: 1.45, cursor: "pointer" } },
              h("input", { type: "checkbox", checked: !!i.checked, onChange: () => void toggleItem(i), style: { marginTop: 4 } }),
              h("span", { style: i.checked ? { color: T.meta, textDecoration: "line-through" } : null }, i.text))),
          h("input", {
            value: newItem[cl.id] || "", placeholder: "+ Add an item", "aria-label": "Add checklist item",
            onChange: (e) => setNewItem((m) => ({ ...m, [cl.id]: e.target.value })),
            onKeyDown: (e) => { if (e.key === "Enter") void addItem(cl); },
            style: { marginTop: 6, width: "100%", boxSizing: "border-box", font: "inherit", fontSize: "0.88rem", padding: "6px 10px", borderRadius: 10, border: "1px dashed " + T.border, background: "transparent", color: T.text },
          }));
      }),
      extra && lists.length === 0
        ? h("div", null, h("button", { type: "button", onClick: async () => { try { await write.addChecklist(c.id, "Checklist"); loadExtra(); } catch (e) { setErr(String(e.message || e)); } } }, "+ Add checklist"))
        : null,
      thread
        ? h("section", null, sectionTitle("Buzz conversation"), h(ThreadPanel, { target: thread, onPosted: () => props.onCommented(c.id) }))
        : null,
      extra && !thread
        ? h("section", null,
            sectionTitle("Comments · " + comments.length + (comments.length ? " · newest first" : "")),
            h("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 } },
              h("textarea", {
                value: draft, rows: 2, placeholder: "Write a comment…", "aria-label": "Write a comment", disabled: sending,
                onChange: (e) => setDraft(e.target.value),
                onKeyDown: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void sendComment(); } },
                style: { font: "inherit", fontSize: "0.92rem", padding: "8px 10px", borderRadius: 12, border: "1px solid " + T.border, background: "transparent", color: T.text, resize: "vertical" },
              }),
              draft.trim()
                ? h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
                    h("button", { type: "button", onClick: () => void sendComment(), disabled: sending, style: { fontWeight: 650 } }, sending ? "Posting…" : "Comment"),
                    h("span", { style: { fontSize: "0.78rem", color: T.meta } }, "⌘ Enter"))
                : null),
            (all ? comments : comments.slice(0, 5)).map((m) => h(Comment, { key: m.id, comment: m })),
            comments.length > 5 && !all ? h("button", { type: "button", onClick: () => setAll(true), style: { marginTop: 6 } }, "Show all " + comments.length + " comments") : null)
        : null,
    );
  }

  // ---------- live Buzz conversation behind a card ----------
  // The Sunnn team, so anyone can be tagged even before they've spoken in the
  // thread. Profile names from Buzz win when present.
  const TEAM = [
    ["Opus", "74cda51ee34d525c5bc7797f65e6b37f5ee94874698501cdb392bcd05b70bcac"],
    ["Opis", "dc574c2b8dadefc47eb0c19572ba799c89d51da9110e507cde74f8056783b6c0"],
    ["Opas", "9ca950b202a563a9a0000d2218296c003f53e6ecad0e68603007cac5b772e80c"],
    ["Fable", "cd5b3f8bf9cfc1c3afc2b749cf2d69d49917737135fa053540e0235cf8505f1b"],
    ["Fabla", "0c0620b45387544a4838bb24e30e620b64ac575792b7e456936a597fe47f415e"],
    ["Fabli", "8a4309f8a2cdccaaf204f74d74306f7841d709b384a6f2bcf17dc34f32339718"],
    ["Sonnet", "29bb54ef58e1e16f5a92090476dc9df21e0ba0779737569c111aae19588d697c"],
    ["Sonnat", "cc9a24f32f594a9fac9319ef73d76997a9ed2ef039175a748024de72ed353e0d"],
    ["Sonnit", "e1380fb4c2d37e209fa1c9f2cb612e897c218586539399433d3c38d5e3d332d2"],
    ["Astra", "5e598687d9b88c4a37301ff88dea6f6938c7a84cb1df4b8be14b622b81500994"],
    ["Sol", "6863656c4580bd1219bb29198f8e890a39e0cbfef118b3efd5d9d9e6ec88746b"],
    ["Nick", "2aa66724472b58e9a32f5fe474618abbac4686ce9a4001064e26391f0a7cffc4"],
    ["James", "f0f37e7c175aadcf46834d9650acc099de3c47c222052802d6a2daf79de1287b"],
  ];
  function relaySession() {
    const relay = ctx.reflect && ctx.reflect.get ? ctx.reflect.get("relay") : undefined;
    const snap = relay && relay.snapshot ? relay.snapshot() : null;
    return snap && snap.session && snap.status !== "error" ? snap.session : null;
  }

  function ThreadPanel(props) {
    const { target } = props;
    const session = relaySession();
    const [snap, setSnap] = useState(null);
    const [names, setNames] = useState(() => new Map());
    const [draft, setDraft] = useState("");
    const [tags, setTags] = useState([]); // [{ pubkey, name }]
    const [alsoChannel, setAlsoChannel] = useState(false);
    const [sending, setSending] = useState(false);
    const [err, setErr] = useState(null);
    const [shown, setShown] = useState(12);
    const box = useRef(null);

    useEffect(() => {
      if (!session || !session.thread) return undefined;
      let view;
      try {
        view = session.thread(target.channel, target.id);
      } catch (e) {
        setErr(String(e.message || e));
        return undefined;
      }
      const update = () => setSnap(view.snapshot());
      const off = view.subscribe(update);
      update();
      void view.refresh().catch(() => undefined);
      return () => { off(); view.dispose(); };
    }, [session, target.channel, target.id]);

    const rows = snap ? [snap.root, ...(snap.replies || [])].filter(Boolean) : [];
    const authors = useMemo(() => Array.from(new Set(rows.map((r) => r.authorId))), [rows.length]);
    useEffect(() => {
      const p = session && session.profiles;
      if (!p || !authors.length) return undefined;
      try { if (p.ensure) p.ensure(authors); } catch { /* best effort */ }
      const read = () => { try { setNames(new Map(p.snapshot ? p.snapshot() : [])); } catch { /* ignore */ } };
      read();
      return p.subscribe ? p.subscribe(read) : undefined;
    }, [session, authors.join(",")]);
    const nameOf = (id) => { const pr = names.get(id); return (pr && pr.name) || id.slice(0, 8); };

    if (!session) return h("p", { style: { color: T.meta, margin: 0 } }, "Buzz is still connecting. The conversation will show here in a moment.");
    if (err) return h("p", { style: { color: T.danger, margin: 0 } }, err);

    const viewer = (() => { try { return ctx.reflect.get("relay").snapshot().viewer || ""; } catch { return ""; } })();
    const teamName = new Map(TEAM.map(([n, k]) => [k, n]));
    // Thread participants first (most likely to be tagged), then the rest of the team.
    const people = [...authors, ...TEAM.map(([, k]) => k).filter((k) => !authors.includes(k))]
      .filter((id) => id !== viewer)
      .map((id) => ({ pubkey: id, name: (names.get(id) && !names.get(id).nameIsFallback && names.get(id).name) || teamName.get(id) || id.slice(0, 8) }));
    const addTag = (p) => {
      if (tags.some((t) => t.pubkey === p.pubkey)) return;
      setTags([...tags, p]);
      if (!draft.includes("@" + p.name)) setDraft((draft ? draft.replace(/\s*$/, " ") : "") + "@" + p.name + " ");
      if (box.current) box.current.focus();
    };
    async function send() {
      const text = draft.trim();
      if (!text) return;
      const root = (snap && snap.root && snap.root.id) || target.id;
      const mentions = tags.filter((t) => text.includes("@" + t.name)).map((t) => t.pubkey);
      setSending(true);
      setErr(null);
      try {
        session.messages.reply(target.channel, root, text, mentions);
        if (alsoChannel) session.messages.send(target.channel, text, mentions);
        setDraft("");
        setTags([]);
        props.onPosted && props.onPosted();
      } catch (e) {
        setErr(String(e.message || e));
      } finally {
        setSending(false);
      }
    }
    const visible = rows.slice(-shown);
    return h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 4 } },
      !snap || snap.status === "loading" && !rows.length ? h("p", { style: { color: T.meta, margin: 0 } }, "Loading the conversation…") : null,
      rows.length > visible.length || (snap && snap.canLoadMore)
        ? h("button", { type: "button", style: { alignSelf: "flex-start", fontSize: "0.82rem" }, onClick: () => { setShown(shown + 20); } }, "Show earlier messages")
        : null,
      visible.map((m) =>
        h("article", { key: m.id, style: { padding: "10px 0", borderTop: "1px solid " + T.border, opacity: m.delivery && m.delivery !== "accepted" && m.delivery !== "seen" ? 0.6 : 1 } },
          h("div", { style: { display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4 } },
            h("strong", { style: { fontSize: "0.9rem" } }, nameOf(m.authorId)),
            h("span", { style: { fontSize: "0.78rem", color: T.meta } }, ago(new Date((m.createdAtMs || m.createdAt * 1000)).toISOString())),
            m.audience === "agents" ? h("span", { style: { fontSize: "0.72rem", color: T.meta } }, "· agents") : null),
          h(RichText, { text: String(m.content || "").length > 900 ? String(m.content).slice(0, 860) + "…" : m.content }))),
      h("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingTop: 10, borderTop: "1px solid " + T.border } },
        h("textarea", {
          ref: box, value: draft, rows: 3, placeholder: "Reply in the Buzz thread…", "aria-label": "Reply in the Buzz thread", disabled: sending,
          onChange: (e) => setDraft(e.target.value),
          onKeyDown: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } },
          style: { font: "inherit", fontSize: "0.92rem", padding: "8px 10px", borderRadius: 12, border: "1px solid " + T.strong, background: "transparent", color: T.text, resize: "vertical" },
        }),
        people.length
          ? h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
              h("span", { style: { fontSize: "0.78rem", color: T.meta } }, "Tag:"),
              people.slice(0, 16).map((p) =>
                h("button", { key: p.pubkey, type: "button", onClick: () => addTag(p), "aria-pressed": tags.some((t) => t.pubkey === p.pubkey),
                  style: { fontSize: "0.8rem", padding: "2px 10px", fontWeight: tags.some((t) => t.pubkey === p.pubkey) ? 700 : 500 } }, "@" + p.name)))
          : null,
        h("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" } },
          h("button", { type: "button", onClick: () => void send(), disabled: sending || !draft.trim(), style: { fontWeight: 650 } }, sending ? "Sending…" : "Send to thread"),
          h("label", { style: { display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.82rem", color: T.subtle } },
            h("input", { type: "checkbox", checked: alsoChannel, onChange: (e) => setAlsoChannel(e.target.checked) }), "Also post in the channel"),
          h("span", { style: { fontSize: "0.76rem", color: T.meta } }, "⌘ Enter"))),
    );
  }

  // ---------- AI plan usage (fleet capacity snapshot, Operations board only) ----------
  function UsageStrip(props) {
    const [snap, setSnap] = useState(null);
    const [open, setOpen] = useState(memory.usageOpen !== false);
    useEffect(() => {
      let live = true;
      const load = () =>
        api("/api/sales/action-items/fleet-capacity?boardId=" + encodeURIComponent(props.boardId))
          .then((d) => live && setSnap((d && d.snapshot) || null))
          .catch(() => live && setSnap(null));
      load();
      const t = setInterval(load, 5 * 60 * 1000);
      return () => { live = false; clearInterval(t); };
    }, [props.boardId]);
    if (!snap || !Array.isArray(snap.agents) || !snap.agents.length) return null;
    // One tile per subscription (account); agents on the same login share it.
    const plans = new Map();
    snap.agents.forEach((a) => {
      const k = a.account || a.pool;
      const p = plans.get(k) || { account: k, pool: a.pool, agents: [], windows: new Map(), state: "ok", observedAt: a.observedAt, reset: a.quotaResetAt || null };
      p.agents.push(a.name);
      (a.windows || []).forEach((w) => { const prev = p.windows.get(w.label); if (!prev || w.usedPercent > prev.usedPercent) p.windows.set(w.label, w); });
      const rank = { exhausted: 3, high: 2, unknown: 1, ok: 0 };
      if ((rank[a.quotaState] || 0) > (rank[p.state] || 0)) p.state = a.quotaState;
      if (a.observedAt && (!p.observedAt || a.observedAt > p.observedAt)) p.observedAt = a.observedAt;
      plans.set(k, p);
    });
    const stale = (iso) => !iso || Date.now() - new Date(iso).getTime() > 20 * 60 * 1000;
    const until = (iso) => {
      if (!iso) return "";
      const ms = new Date(iso).getTime() - Date.now();
      if (ms <= 0) return "resetting now";
      const hrs = ms / 3600000;
      return "resets in " + (hrs < 1 ? Math.round(ms / 60000) + " min" : hrs < 48 ? Math.round(hrs) + "h" : Math.round(hrs / 24) + "d");
    };
    const barColor = (pct) => (pct >= 95 ? "#e5484d" : pct >= 75 ? "#f5a524" : "#30a46c");
    const toggle = () => { memory.usageOpen = !open; setOpen(!open); };
    return h(
      "section",
      { "aria-label": "AI plan usage", style: { display: "flex", flexDirection: "column", gap: 8 } },
      h("button", { type: "button", onClick: toggle, style: { alignSelf: "flex-start", border: "none", background: "transparent", padding: 0, color: T.meta, fontSize: "0.78rem", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", cursor: "pointer" } },
        (open ? "▾ " : "▸ ") + "AI plan usage"),
      open
        ? h("div", { style: { display: "flex", gap: 10, overflowX: "auto", paddingBottom: 2 } },
            Array.from(plans.values()).map((p) => {
              const ws = Array.from(p.windows.values());
              const old = stale(p.observedAt);
              return h("div", {
                key: p.account,
                style: { flex: "0 0 auto", minWidth: 220, padding: "10px 14px", borderRadius: 16, background: "var(--surface-base, " + T.panel + ")", border: "1px solid " + (p.state === "exhausted" ? "#e5484d" : T.border), display: "flex", flexDirection: "column", gap: 6 },
              },
                h("div", { style: { display: "flex", gap: 8, alignItems: "baseline" } },
                  h("strong", { style: { fontSize: "0.92rem" } }, p.account),
                  p.state === "exhausted" ? h(Pill, { color: "#fff", bg: "#e5484d" }, "Used up") : p.state === "high" ? h(Pill, { color: T.warning, bg: tint(T.warning, 16) }, "Running high") : null),
                h("span", { style: { fontSize: "0.8rem", color: T.subtle } }, p.agents.join(", ")),
                ws.map((w) =>
                  h("div", { key: w.label, style: { display: "flex", flexDirection: "column", gap: 3 } },
                    h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "0.8rem" } },
                      h("span", null, w.label), h("span", { style: { fontWeight: 650, fontVariantNumeric: "tabular-nums" } }, old ? "?" : Math.round(w.usedPercent) + "% used")),
                    h("div", { style: { height: 6, borderRadius: 3, background: tint("currentColor", 10) } },
                      h("div", { style: { width: (old ? 0 : Math.min(100, w.usedPercent)) + "%", height: "100%", borderRadius: 3, background: barColor(w.usedPercent) } })),
                    w.resetAt ? h("span", { style: { fontSize: "0.74rem", color: T.meta } }, until(w.resetAt)) : null)),
                old ? h("span", { style: { fontSize: "0.74rem", color: T.meta } }, "No fresh reading" + (p.observedAt ? " since " + ago(p.observedAt) : "")) : null);
            }))
        : null);
  }

  // ---------- page ----------
  function BoardPage() {
    const key = useKey();
    const [authError, setAuthError] = useState(null);
    if (!key || authError) return h(Connect, { reason: authError, onDone: () => setAuthError(null) });
    return h(Board, { onAuthError: (msg) => { setKey(""); setAuthError(msg); } });
  }

  function Board(props) {
    const [boards, setBoards] = useState([]);
    const [boardId, setBoardIdState] = useState(memory.boardId);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState("");
    const [openId, setOpenId] = useState(null);
    const [stamp, setStamp] = useState(null);
    const [loading, setLoading] = useState(false);
    const [filter, setFilterState] = useState(memory.filter);
    const [order, setOrderState] = useState(memory.order);
    const [collapsed, setCollapsed] = useState(memory.collapsed);
    const [dragId, setDragId] = useState(null);
    const [me, setMe] = useState(null);
    const [, tick] = useState(0);
    const search = useRef(null);
    const scroller = useRef(null);
    const busy = useRef(0); // writes in flight: polling waits for them

    const setBoardId = (id) => { memory.boardId = id; setBoardIdState(id); };
    const setFilter = (f) => { memory.filter = f; setFilterState(f); };
    const setOrder = (o) => { memory.order = o; setOrderState(o); };
    const fail = (e) => {
      if (e && e.code === "auth") props.onAuthError(e.message);
      else setError(String((e && e.message) || e));
    };

    useEffect(() => {
      api("/api/sales/me").then(setMe).catch(fail);
      read({ op: "boards" })
        .then((d) => {
          const bs = (d.boards || []).slice().sort((a, b) => a.position - b.position);
          setBoards(bs);
          if (!memory.boardId || !bs.some((b) => b.id === memory.boardId)) setBoardId((bs[0] && bs[0].id) || null);
        })
        .catch(fail);
    }, []);

    const load = useCallback((quiet) => {
      if (!boardId || busy.current > 0) return;
      if (!quiet) setLoading(true);
      read({ op: "board", boardId })
        .then((d) => { if (busy.current === 0) { setData(d); setError(null); setStamp(Date.now()); } })
        .catch(fail)
        .finally(() => setLoading(false));
    }, [boardId]);

    useEffect(() => {
      setData(null);
      setOpenId(null);
      load();
      const t = setInterval(() => load(true), REFRESH_MS);
      const t2 = setInterval(() => tick((n) => n + 1), 30000);
      return () => { clearInterval(t); clearInterval(t2); };
    }, [load]);

    useEffect(() => {
      function onKey(e) {
        const tag = (e.target && e.target.tagName) || "";
        const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
        if (e.key === "/" && !typing && search.current) { e.preventDefault(); search.current.focus(); }
        else if (e.key === "Escape" && !typing) setOpenId(null);
        else if (e.key === "Escape" && tag === "INPUT" && e.target === search.current && query) setQuery("");
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [query]);

    // Drag the empty board background left/right to see every stage.
    useEffect(() => {
      const el = scroller.current;
      if (!el) return undefined;
      let start = null;
      const down = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest("[data-card-id],button,input,textarea,select,a,[role=button]")) return;
        start = { x: e.clientX, left: el.scrollLeft, moved: false };
      };
      const move = (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        if (Math.abs(dx) > 3) start.moved = true;
        if (start.moved) { el.scrollLeft = start.left - dx; el.style.cursor = "grabbing"; e.preventDefault(); }
      };
      const up = () => { start = null; el.style.cursor = ""; };
      el.addEventListener("mousedown", down);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return () => { el.removeEventListener("mousedown", down); window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    }, [data]);

    // ---- writes: optimistic, then saved; on failure put it back ----
    async function run(apply, save, failMsg) {
      const before = data;
      busy.current++;
      setData((d) => (d ? apply(d) : d));
      try {
        const out = await save();
        return out || true;
      } catch (e) {
        setData(before);
        if (e && e.code === "auth") props.onAuthError(e.message);
        else setError(failMsg + " " + String((e && e.message) || e));
        return false;
      } finally {
        busy.current--;
        setStamp(Date.now());
      }
    }
    const patchLocal = (id, patch) => (d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
    const onPatch = (id, patch) => run(patchLocal(id, patch), () => write.patchCard(id, patch), "Couldn't save that change.");

    function moveCard(cardId, listId, beforeId) {
      if (!data) return;
      const dest = data.cards.filter((c) => c.listId === listId && c.id !== cardId).sort((a, b) => a.position - b.position);
      let idx = beforeId ? dest.findIndex((c) => c.id === beforeId) : dest.length;
      if (idx < 0) idx = dest.length;
      const card = data.cards.find((c) => c.id === cardId);
      if (!card) return;
      const lower = idx === 0 ? 0 : dest[idx - 1].position;
      const gap = idx < dest.length ? dest[idx].position - lower : Infinity;
      if (dest.length && gap < 1e-6) {
        // Positions squeezed too tight to bisect: renumber the column like sales.sunnn.co does.
        const renum = dest.map((c, i) => ({ id: c.id, position: (i + 1) * 1000 + (i >= idx ? 1000 : 0) }));
        const pos = (idx + 1) * 1000;
        return run(
          (d) => ({ ...d, cards: d.cards.map((c) => { const r = renum.find((x) => x.id === c.id); return r ? { ...c, position: r.position } : c.id === cardId ? { ...c, listId, position: pos } : c; }) }),
          async () => { await write.reorder(listId, renum); return write.patchCard(cardId, { listId, position: pos }); },
          "Couldn't move that card.",
        );
      }
      let pos;
      if (!dest.length) pos = 1000;
      else if (idx >= dest.length) pos = dest[dest.length - 1].position + 1000;
      else if (idx === 0) pos = dest[0].position / 2;
      else pos = (dest[idx - 1].position + dest[idx].position) / 2;
      if (card.listId === listId && card.position === pos) return;
      const patch = { listId, position: pos };
      return run(patchLocal(cardId, patch), () => write.patchCard(cardId, patch), "Couldn't move that card.");
    }

    async function addCard(listId, title) {
      const dest = data.cards.filter((c) => c.listId === listId);
      const position = (dest.length ? Math.max(...dest.map((c) => c.position)) : 0) + 1000;
      const temp = { id: "temp-" + Date.now(), listId, title, description: "", position, labels: [], commentCount: 0, unreadCount: 0 };
      busy.current++;
      setData((d) => ({ ...d, cards: [...d.cards, temp] }));
      try {
        const out = await write.createCard({ listId, title, position });
        const card = (out && out.card) || null;
        setData((d) => ({ ...d, cards: d.cards.map((c) => (c.id === temp.id ? { ...temp, ...(card || {}) } : c)) }));
        return true;
      } catch (e) {
        setData((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== temp.id) }));
        fail(e);
        return false;
      } finally {
        busy.current--;
      }
    }

    function archiveCard(id) {
      setOpenId(null);
      return run((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }), () => write.archiveCard(id), "Couldn't archive that card.");
    }

    const doneIds = useMemo(() => new Set(((data && data.lists) || []).filter((l) => isDoneList(l.title)).map((l) => l.id)), [data]);
    const openCards = useMemo(() => (data ? data.cards.filter((c) => !doneIds.has(c.listId)) : []), [data, doneIds]);
    const sortedLists = useMemo(() => ((data && data.lists) || []).slice().sort((a, b) => a.position - b.position), [data]);
    const people = useMemo(() => {
      const s = new Set();
      if (me && me.email) s.add(me.email.toLowerCase());
      ((data && data.cards) || []).forEach((c) => { if (c.assignedTo) s.add(c.assignedTo.toLowerCase()); });
      return Array.from(s).sort();
    }, [data, me]);

    const tests = {
      all: () => true,
      mine: (c) => me && c.assignedTo && c.assignedTo.toLowerCase() === String(me.email).toLowerCase(),
      overdue: (c) => { const d = dueInfo(c); return d && d.tone === "overdue"; },
      week: (c) => { const d = dueInfo(c); return d && d.tone !== "later"; },
      unread: (c) => c.unreadCount > 0,
      active: (c) => c.lastCommentAt && Date.now() - new Date(c.lastCommentAt).getTime() < DAY,
      agent: (c) => !!c.agentDoneAt,
    };
    const counts = {};
    Object.keys(tests).forEach((k) => { counts[k] = openCards.filter(tests[k]).length; });

    const columns = useMemo(() => {
      if (!data) return [];
      const q = query.trim().toLowerCase();
      const test = tests[filter] || tests.all;
      return sortedLists.map((l) => {
        let cards = data.cards.filter((c) => c.listId === l.id);
        if (q) cards = cards.filter((c) => (c.title + " " + (c.description || "")).toLowerCase().includes(q));
        if (filter !== "all") cards = cards.filter(test);
        if (order === "activity") cards.sort((a, b) => String(b.lastCommentAt || b.updatedAt || "").localeCompare(String(a.lastCommentAt || a.updatedAt || "")));
        else if (order === "due") cards.sort((a, b) => ((dueInfo(a) || {}).date || 9e15) - ((dueInfo(b) || {}).date || 9e15));
        else cards.sort((a, b) => a.position - b.position);
        const total = q || filter !== "all" ? cards.length : (data.totals && data.totals[l.id]) || cards.length;
        const isCollapsed = collapsed[l.id] != null ? collapsed[l.id] : isDoneList(l.title);
        return { list: l, cards, total, collapsed: isCollapsed };
      });
    }, [data, query, filter, order, collapsed, me]);

    const toggle = (id, cur) => {
      const next = { ...collapsed, [id]: !cur };
      memory.collapsed = next;
      setCollapsed(next);
    };

    const openCard = data && openId ? data.cards.find((c) => c.id === openId) : null;
    const openList = openCard ? (data.lists.find((l) => l.id === openCard.listId) || {}).title : "";
    const filtering = !!query.trim() || filter !== "all";
    // Drag order only means something in board order with no filter.
    const canDrag = order === "board";
    const doneListId = (sortedLists.find((l) => isDoneList(l.title)) || {}).id || null;

    return h(
      "div",
      { style: { height: "100%", display: "flex", flexDirection: "column", gap: 14, color: T.text, padding: "var(--space-workspace-inset, 16px) var(--space-panel-inset, 24px)", boxSizing: "border-box", minHeight: 0 } },
      h("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } },
        h("h1", { style: { margin: 0, fontSize: "1.5rem", lineHeight: 1.2 } }, "Project board"),
        h("div", { role: "tablist", "aria-label": "Boards", style: { display: "flex", gap: 2, padding: 3, borderRadius: 999, background: T.inset, border: "1px solid " + T.border, flexWrap: "wrap" } },
          boards.map((b) =>
            h("button", {
              key: b.id, type: "button", role: "tab", "aria-selected": b.id === boardId, onClick: () => setBoardId(b.id),
              style: {
                padding: "6px 14px", borderRadius: 999, fontSize: "0.88rem", cursor: "pointer", border: "none", font: "inherit", color: T.text,
                fontWeight: b.id === boardId ? 650 : 500, background: b.id === boardId ? "var(--surface-base, " + T.panel + ")" : "transparent",
                boxShadow: b.id === boardId ? "var(--shadow-sm, 0 1px 2px rgba(0,0,0,.2))" : "none",
              },
            }, b.title))),
        h("span", { style: { flex: 1 } }),
        h("input", {
          ref: search, type: "search", placeholder: "Search cards   /", value: query, "aria-label": "Search cards", onChange: (e) => setQuery(e.target.value),
          style: { padding: "8px 14px", borderRadius: 999, border: "1px solid " + T.border, background: "var(--surface-base, transparent)", color: "inherit", font: "inherit", fontSize: "0.9rem", width: 240, maxWidth: "100%" },
        }),
        h("button", { type: "button", onClick: () => load(), title: "Refresh now", "aria-label": "Refresh" }, loading ? "…" : "↻"),
        h("button", {
          type: "button", title: me ? "Connected as " + me.email + ". Click to disconnect this computer." : "Disconnect",
          onClick: () => { if (window.confirm("Disconnect the project board on this computer? You'll need to paste a key again.")) setKey(""); },
        }, me ? "👤 " + (me.name || personName(me.email)) : "👤")),
      h("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
        h(Chip, { active: filter === "all", onClick: () => setFilter("all"), count: openCards.length }, "All open"),
        counts.mine ? h(Chip, { active: filter === "mine", onClick: () => setFilter("mine"), count: counts.mine }, "Mine") : null,
        h(Chip, { active: filter === "overdue", onClick: () => setFilter("overdue"), count: counts.overdue }, h("span", { style: { color: filter === "overdue" ? "inherit" : T.danger } }, "●"), "Overdue"),
        h(Chip, { active: filter === "week", onClick: () => setFilter("week"), count: counts.week }, "Due this week"),
        counts.unread ? h(Chip, { active: filter === "unread", onClick: () => setFilter("unread"), count: counts.unread }, "Unread") : null,
        h(Chip, { active: filter === "active", onClick: () => setFilter("active"), count: counts.active }, "Active today"),
        counts.agent ? h(Chip, { active: filter === "agent", onClick: () => setFilter("agent"), count: counts.agent }, "Agent done, needs a look") : null,
        h("span", { style: { flex: 1 } }),
        h("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.84rem", color: T.subtle } }, "Order",
          h("select", { value: order, onChange: (e) => setOrder(e.target.value), style: { font: "inherit", fontSize: "0.84rem", padding: "4px 8px", borderRadius: 10, border: "1px solid " + T.border, background: "var(--surface-base, transparent)", color: T.text } },
            h("option", { value: "board" }, "Board order"), h("option", { value: "activity" }, "Latest activity"), h("option", { value: "due" }, "Due date"))),
        h("span", { style: { fontSize: "0.8rem", color: T.meta } }, stamp ? "Updated " + ago(new Date(stamp).toISOString()) : "Loading…")),
      boardId ? h(UsageStrip, { key: boardId, boardId }) : null,
      error
        ? h("div", { role: "alert", style: { display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderRadius: 14, background: tint(T.danger, 12), color: T.text, fontSize: "0.9rem" } },
            h("span", { style: { flex: 1 } }, error), h("button", { type: "button", onClick: () => { setError(null); load(); } }, "Try again"))
        : null,
      h("div", { style: { flex: 1, minHeight: 0, display: "flex", gap: 14 } },
        h("div", { ref: scroller, style: { flex: 1, minWidth: 0, display: "flex", gap: 12, overflowX: "auto", alignItems: "flex-start", paddingBottom: 8, cursor: dragId ? "grabbing" : undefined } },
          !data && !error
            ? [0, 1, 2, 3].map((i) => h("div", { key: i, style: { flex: "0 0 300px", height: 240 + i * 40, borderRadius: 18, background: T.inset, border: "1px solid " + T.border, opacity: 0.6 } }))
            : columns.map((col) =>
                h(Column, {
                  key: col.list.id, list: col.list, cards: col.cards, total: col.total, collapsed: col.collapsed, filtered: filtering,
                  readOnly: !canDrag, dragId,
                  onDragStart: (id) => setDragId(id), onDragEnd: () => setDragId(null),
                  onDropCard: (listId, beforeId) => { const id = dragId; setDragId(null); if (id) void moveCard(id, listId, beforeId); },
                  onAdd: addCard,
                  onToggle: () => toggle(col.list.id, col.collapsed), onOpen: (c) => setOpenId(c.id), selectedId: openId,
                }))),
        openCard
          ? h(Detail, {
              card: openCard, listTitle: openList, boardId, lists: sortedLists, people, doneListId,
              onClose: () => setOpenId(null), onPatch, onArchive: archiveCard,
              onMove: (id, listId) => moveCard(id, listId, null),
              onSeen: (id) => setData((d) => (d ? patchLocal(id, { unreadCount: 0 })(d) : d)),
              onCommented: () => load(true),
            })
          : null),
    );
  }

  ctx.pages.register({
    id: "board",
    title: "Project board",
    primary: true,
    icon: ICON,
    layout: "workspace",
    component: BoardPage,
  });
}
