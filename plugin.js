// Project board: the sales.sunnn.co Action Items board inside Buzz.
// Read-only. Data comes from ~/.buzz/bin/sunnn-board-read (declared in
// manifest.host.commands, hash-pinned), which holds the sales read key so
// this module never sees it. Styling uses Buzz design tokens so the board
// follows the app's light/dark theme and text size.

export const inject = ["react", "pages", "host", "navigation"];

const SALES = "https://sales.sunnn.co/action-items";
const REFRESH_MS = 60000;
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

  async function read(req) {
    const out = await ctx.host.runCommand("board-read", JSON.stringify(req));
    if (out == null) throw new Error("Couldn't reach the board. Check the Mac is online and try again.");
    const data = JSON.parse(out);
    if (data && data.error) throw new Error(data.error);
    return data;
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

  // ---------- card tile ----------
  function CardTile(props) {
    const c = props.card;
    const due = dueInfo(c);
    const labels = Array.isArray(c.labels) ? c.labels : [];
    const hint = preview(c.description);
    const fresh = c.lastCommentAt && Date.now() - new Date(c.lastCommentAt).getTime() < DAY;
    return h(
      "button",
      {
        type: "button",
        onClick: () => props.onOpen(c),
        "aria-current": props.selected ? "true" : undefined,
        style: {
          display: "flex", flexDirection: "column", gap: 8, width: "100%", textAlign: "left", cursor: "pointer",
          padding: "12px 14px", borderRadius: 14, font: "inherit", color: T.text,
          background: "var(--surface-base, " + T.panel + ")",
          border: "1px solid " + (props.selected ? T.focus : T.border),
          boxShadow: props.selected ? "0 0 0 1px " + T.focus : "var(--shadow-sm, none)",
          borderLeft: c.coverColor ? "4px solid " + labelColor(c.coverColor) : undefined,
        },
      },
      labels.length
        ? h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
            labels.map((l, i) => h(Pill, { key: i, dot: labelColor(l.color), bg: tint(labelColor(l.color), 12), color: T.subtle }, l.name || "Label")))
        : null,
      h("div", { style: { fontSize: "0.98rem", lineHeight: 1.4, fontWeight: 600, overflowWrap: "anywhere" } }, c.title),
      hint
        ? h("div", {
            style: {
              fontSize: "0.85rem", lineHeight: 1.45, color: T.subtle, display: "-webkit-box",
              WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            },
          }, hint)
        : null,
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 } },
        h(DuePill, { due }),
        c.agentDoneAt ? h(Pill, { color: T.success, bg: tint(T.success, 14), title: "An agent marked this done " + ago(c.agentDoneAt) }, "✓ Agent done") : null,
        c.assignedTo ? h(Pill, { outline: true, title: c.assignedTo }, "👤 " + personName(c.assignedTo)) : null,
        h("span", { style: { flex: 1 } }),
        c.commentCount
          ? h("span", {
              title: c.lastCommentAt ? "Last comment " + ago(c.lastCommentAt) + (c.lastCommentBy ? " by " + personName(c.lastCommentBy) : "") : "Comments",
              style: { fontSize: "0.78rem", color: fresh ? T.text : T.meta, fontWeight: fresh ? 650 : 500, whiteSpace: "nowrap" },
            },
            fresh ? h("span", { style: { display: "inline-block", width: 7, height: 7, borderRadius: 4, background: "var(--accent-9, #0090ff)", marginRight: 5, verticalAlign: 1 } }) : null,
            "💬 " + c.commentCount + (c.lastCommentAt ? " · " + ago(c.lastCommentAt) : ""))
          : null,
      ),
    );
  }

  // ---------- column ----------
  function Column(props) {
    const { list, cards, total, collapsed } = props;
    const tone = listTone(list.title);
    if (collapsed) {
      return h(
        "button",
        {
          type: "button",
          onClick: props.onToggle,
          title: "Show " + niceTitle(list.title),
          style: {
            flex: "0 0 48px", alignSelf: "stretch", maxHeight: "100%", display: "flex", flexDirection: "column", alignItems: "center",
            gap: 10, padding: "14px 0", borderRadius: 18, cursor: "pointer", font: "inherit", color: T.text,
            background: T.inset, border: "1px solid " + T.border, borderTop: "3px solid " + tone,
          },
        },
        h("span", { style: { fontSize: "0.78rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" } }, total),
        h("span", { style: { writingMode: "vertical-rl", fontSize: "0.86rem", fontWeight: 650, whiteSpace: "nowrap" } }, niceTitle(list.title)),
      );
    }
    return h(
      "section",
      {
        "aria-label": niceTitle(list.title),
        style: {
          flex: "0 0 300px", maxHeight: "100%", display: "flex", flexDirection: "column", borderRadius: 18,
          background: T.inset, border: "1px solid " + T.border, borderTop: "3px solid " + tone,
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
        { style: { overflowY: "auto", padding: "4px 10px 12px", display: "flex", flexDirection: "column", gap: 10 } },
        cards.length
          ? cards.map((c) => h(CardTile, { key: c.id, card: c, onOpen: props.onOpen, selected: props.selectedId === c.id }))
          : h("p", { style: { color: T.meta, fontSize: "0.85rem", margin: "6px 4px 10px" } }, props.filtered ? "Nothing matches" : "No cards"),
      ),
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

  // ---------- detail ----------
  function Detail(props) {
    const c = props.card;
    const [extra, setExtra] = useState(null);
    const [err, setErr] = useState(null);
    const [all, setAll] = useState(false);
    const [jump, setJump] = useState(null);
    const scroller = useRef(null);
    useEffect(() => {
      let live = true;
      setExtra(null);
      setErr(null);
      setAll(false);
      setJump(null);
      if (scroller.current) scroller.current.scrollTop = 0;
      read({ op: "card", id: c.id })
        .then((d) => live && setExtra(d))
        .catch((e) => live && setErr(String(e.message || e)));
      return () => { live = false; };
    }, [c.id]);
    const lists = (extra && extra.checklists && extra.checklists.checklists) || [];
    const items = (extra && extra.checklists && extra.checklists.items) || [];
    const comments = (extra && extra.comments && extra.comments.comments) || [];
    const due = dueInfo(c);
    const thread = buzzTarget(c.description);
    const facts = [
      ["Column", niceTitle(props.listTitle)],
      c.assignedTo ? ["Assigned", personName(c.assignedTo)] : null,
      due ? ["Due", due.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })] : null,
      c.repName ? ["Rep", c.repName] : null,
      c.customerPrice ? ["Price", "$" + Number(c.customerPrice).toLocaleString()] : null,
      c.lastCommentAt ? ["Activity", ago(c.lastCommentAt) + (c.lastCommentBy ? " · " + personName(c.lastCommentBy) : "")] : null,
    ].filter(Boolean);
    const sectionTitle = (t) => h("h3", { style: { margin: "4px 0 8px", fontSize: "0.78rem", fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: T.meta } }, t);
    return h(
      "aside",
      {
        ref: scroller,
        "aria-label": "Card details",
        style: {
          flex: "0 1 460px", minWidth: 320, overflowY: "auto", padding: "20px 22px", borderRadius: 20,
          background: "var(--surface-base, " + T.panel + ")", border: "1px solid " + T.border,
          display: "flex", flexDirection: "column", gap: 16,
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "flex-start", gap: 10 } },
        h("h2", { style: { margin: 0, fontSize: "1.25rem", lineHeight: 1.35, flex: 1, overflowWrap: "anywhere" } }, c.title),
        h("button", { type: "button", onClick: props.onClose, "aria-label": "Close details", title: "Close (Esc)" }, "✕"),
      ),
      h(
        "div",
        { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
        thread
          ? h("button", {
              type: "button",
              onClick: async () => {
                setJump("opening");
                const r = await openBuzz(thread);
                setJump(r && r.status === "opened" ? null : "failed");
              },
              style: { fontWeight: 650 },
            }, jump === "opening" ? "Opening…" : "💬 Open thread in Buzz")
          : null,
        h("a", { href: SALES + "?board=" + props.boardId, target: "_blank", rel: "noreferrer", style: { alignSelf: "center", fontSize: "0.86rem", color: T.subtle } }, "Open in sales.sunnn.co ↗"),
      ),
      jump === "failed" ? h("p", { style: { margin: 0, color: T.danger, fontSize: "0.85rem" } }, "Couldn't open that thread here. It may be in a channel you haven't joined.") : null,
      h(
        "dl",
        { style: { display: "grid", gridTemplateColumns: "88px 1fr", gap: "6px 12px", margin: 0, fontSize: "0.9rem" } },
        facts.map(([k, v]) => [
          h("dt", { key: k + "k", style: { color: T.meta } }, k),
          h("dd", { key: k + "v", style: { margin: 0 } }, v),
        ]),
      ),
      h(
        "section",
        null,
        sectionTitle("Description"),
        c.description && cleanLines(c.description).join("").trim()
          ? h(RichText, { text: c.description })
          : h("p", { style: { color: T.meta, margin: 0 } }, "No description"),
      ),
      err ? h("p", { style: { color: T.danger, margin: 0 } }, err) : null,
      !extra && !err ? h("p", { style: { color: T.meta, margin: 0 } }, "Loading checklists and comments…") : null,
      lists.map((cl) => {
        const mine = items.filter((i) => i.checklistId === cl.id);
        const done = mine.filter((i) => i.checked).length;
        const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
        return h(
          "section",
          { key: cl.id },
          sectionTitle((cl.title || "Checklist") + " · " + done + "/" + mine.length),
          h("div", { style: { height: 6, borderRadius: 3, background: tint("currentColor", 10), marginBottom: 8 } },
            h("div", { style: { width: pct + "%", height: "100%", borderRadius: 3, background: pct === 100 ? T.success : "var(--accent-9, #0090ff)" } })),
          mine.map((i) =>
            h("div", { key: i.id, style: { display: "flex", gap: 10, fontSize: "0.92rem", padding: "3px 0", lineHeight: 1.45 } },
              h("span", { style: { color: i.checked ? T.success : T.meta } }, i.checked ? "☑" : "☐"),
              h("span", { style: i.checked ? { color: T.meta, textDecoration: "line-through" } : null }, i.text),
            ),
          ),
        );
      }),
      extra
        ? h(
            "section",
            null,
            sectionTitle("Comments · " + comments.length + (comments.length ? " · newest first" : "")),
            comments.length ? null : h("p", { style: { color: T.meta, margin: 0 } }, "No comments yet"),
            (all ? comments : comments.slice(0, 5)).map((m) => h(Comment, { key: m.id, comment: m })),
            comments.length > 5 && !all
              ? h("button", { type: "button", onClick: () => setAll(true), style: { marginTop: 6 } }, "Show all " + comments.length + " comments")
              : null,
          )
        : null,
    );
  }

  // ---------- page ----------
  function BoardPage() {
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
    const [, tick] = useState(0);
    const search = useRef(null);

    const setBoardId = (id) => { memory.boardId = id; setBoardIdState(id); };
    const setFilter = (f) => { memory.filter = f; setFilterState(f); };
    const setOrder = (o) => { memory.order = o; setOrderState(o); };

    useEffect(() => {
      read({ op: "boards" })
        .then((d) => {
          const bs = (d.boards || []).slice().sort((a, b) => a.position - b.position);
          setBoards(bs);
          if (!memory.boardId || !bs.some((b) => b.id === memory.boardId)) setBoardId((bs[0] && bs[0].id) || null);
        })
        .catch((e) => setError(String(e.message || e)));
    }, []);

    const load = useCallback(() => {
      if (!boardId) return;
      setLoading(true);
      read({ op: "board", boardId })
        .then((d) => { setData(d); setError(null); setStamp(Date.now()); })
        .catch((e) => setError(String(e.message || e)))
        .finally(() => setLoading(false));
    }, [boardId]);

    useEffect(() => {
      setData(null);
      setOpenId(null);
      load();
      const t = setInterval(load, REFRESH_MS);
      const t2 = setInterval(() => tick((n) => n + 1), 30000);
      return () => { clearInterval(t); clearInterval(t2); };
    }, [load]);

    useEffect(() => {
      function onKey(e) {
        const tag = (e.target && e.target.tagName) || "";
        const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
        if (e.key === "/" && !typing && search.current) { e.preventDefault(); search.current.focus(); }
        else if (e.key === "Escape") {
          if (typing && query) setQuery("");
          else setOpenId(null);
        }
      }
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [query]);

    const doneIds = useMemo(() => new Set(((data && data.lists) || []).filter((l) => isDoneList(l.title)).map((l) => l.id)), [data]);
    const openCards = useMemo(() => (data ? data.cards.filter((c) => !doneIds.has(c.listId)) : []), [data, doneIds]);

    const tests = {
      all: () => true,
      overdue: (c) => { const d = dueInfo(c); return d && d.tone === "overdue"; },
      week: (c) => { const d = dueInfo(c); return d && d.tone !== "later"; },
      active: (c) => c.lastCommentAt && Date.now() - new Date(c.lastCommentAt).getTime() < DAY,
      agent: (c) => !!c.agentDoneAt,
    };
    const counts = useMemo(() => {
      const out = {};
      Object.keys(tests).forEach((k) => { out[k] = openCards.filter(tests[k]).length; });
      return out;
    }, [openCards]);

    const columns = useMemo(() => {
      if (!data) return [];
      const q = query.trim().toLowerCase();
      const test = tests[filter] || tests.all;
      const lists = (data.lists || []).slice().sort((a, b) => a.position - b.position);
      return lists.map((l) => {
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
    }, [data, query, filter, order, collapsed]);

    const toggle = (id, cur) => {
      const next = { ...collapsed, [id]: !cur };
      memory.collapsed = next;
      setCollapsed(next);
    };

    const openCard = data && openId ? data.cards.find((c) => c.id === openId) : null;
    const openList = openCard ? (data.lists.find((l) => l.id === openCard.listId) || {}).title : "";
    const filtering = !!query.trim() || filter !== "all";

    return h(
      "div",
      {
        style: {
          height: "100%", display: "flex", flexDirection: "column", gap: 14, color: T.text,
          padding: "var(--space-workspace-inset, 16px) var(--space-panel-inset, 24px)", boxSizing: "border-box", minHeight: 0,
        },
      },
      // Row 1: title, board switcher, search
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } },
        h("h1", { style: { margin: 0, fontSize: "1.5rem", lineHeight: 1.2 } }, "Project board"),
        h(
          "div",
          { role: "tablist", "aria-label": "Boards", style: { display: "flex", gap: 2, padding: 3, borderRadius: 999, background: T.inset, border: "1px solid " + T.border, flexWrap: "wrap" } },
          boards.map((b) =>
            h(
              "button",
              {
                key: b.id, type: "button", role: "tab", "aria-selected": b.id === boardId,
                onClick: () => setBoardId(b.id),
                style: {
                  padding: "6px 14px", borderRadius: 999, fontSize: "0.88rem", cursor: "pointer", border: "none", font: "inherit",
                  color: T.text, fontWeight: b.id === boardId ? 650 : 500,
                  background: b.id === boardId ? "var(--surface-base, " + T.panel + ")" : "transparent",
                  boxShadow: b.id === boardId ? "var(--shadow-sm, 0 1px 2px rgba(0,0,0,.2))" : "none",
                },
              },
              b.title,
            ),
          ),
        ),
        h("span", { style: { flex: 1 } }),
        h("input", {
          ref: search, type: "search", placeholder: "Search cards   /", value: query, "aria-label": "Search cards",
          onChange: (e) => setQuery(e.target.value),
          style: { padding: "8px 14px", borderRadius: 999, border: "1px solid " + T.border, background: "var(--surface-base, transparent)", color: "inherit", font: "inherit", fontSize: "0.9rem", width: 240, maxWidth: "100%" },
        }),
        h("button", { type: "button", onClick: load, title: "Refresh now", "aria-label": "Refresh" }, loading ? "…" : "↻"),
      ),
      // Row 2: quick filters, order, status
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
        h(Chip, { active: filter === "all", onClick: () => setFilter("all"), count: openCards.length }, "All open"),
        h(Chip, { active: filter === "overdue", onClick: () => setFilter("overdue"), count: counts.overdue }, h("span", { style: { color: filter === "overdue" ? "inherit" : T.danger } }, "●"), "Overdue"),
        h(Chip, { active: filter === "week", onClick: () => setFilter("week"), count: counts.week }, "Due this week"),
        h(Chip, { active: filter === "active", onClick: () => setFilter("active"), count: counts.active }, "Active today"),
        counts.agent ? h(Chip, { active: filter === "agent", onClick: () => setFilter("agent"), count: counts.agent }, "Agent done, needs a look") : null,
        h("span", { style: { flex: 1 } }),
        h(
          "label",
          { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.84rem", color: T.subtle } },
          "Order",
          h(
            "select",
            { value: order, onChange: (e) => setOrder(e.target.value), style: { font: "inherit", fontSize: "0.84rem", padding: "4px 8px", borderRadius: 10, border: "1px solid " + T.border, background: "var(--surface-base, transparent)", color: T.text } },
            h("option", { value: "board" }, "Board order"),
            h("option", { value: "activity" }, "Latest activity"),
            h("option", { value: "due" }, "Due date"),
          ),
        ),
        h("span", { style: { fontSize: "0.8rem", color: T.meta } }, stamp ? "Updated " + ago(new Date(stamp).toISOString()) + " · read-only" : "Loading…"),
      ),
      error
        ? h(
            "div",
            { role: "alert", style: { display: "flex", gap: 10, alignItems: "center", padding: "10px 14px", borderRadius: 14, background: tint(T.danger, 12), color: T.text, fontSize: "0.9rem" } },
            h("span", { style: { flex: 1 } }, error),
            h("button", { type: "button", onClick: load }, "Try again"),
          )
        : null,
      // Board + detail
      h(
        "div",
        { style: { flex: 1, minHeight: 0, display: "flex", gap: 14 } },
        h(
          "div",
          { style: { flex: 1, minWidth: 0, display: "flex", gap: 12, overflowX: "auto", alignItems: "flex-start", paddingBottom: 8 } },
          !data && !error
            ? [0, 1, 2, 3].map((i) => h("div", { key: i, style: { flex: "0 0 300px", height: 240 + i * 40, borderRadius: 18, background: T.inset, border: "1px solid " + T.border, opacity: 0.6 } }))
            : columns.map((col) =>
                h(Column, {
                  key: col.list.id, list: col.list, cards: col.cards, total: col.total, collapsed: col.collapsed, filtered: filtering,
                  onToggle: () => toggle(col.list.id, col.collapsed), onOpen: (c) => setOpenId(c.id), selectedId: openId,
                }),
              ),
        ),
        openCard ? h(Detail, { card: openCard, listTitle: openList, boardId, onClose: () => setOpenId(null) }) : null,
      ),
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
