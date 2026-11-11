// Project board: the sales.sunnn.co Action Items board inside Buzz.
// Read-only preview. Data comes from ~/.buzz/bin/sunnn-board-read (declared
// in manifest.host.commands, hash-pinned), which holds the sales read key so
// this module never sees it.

export const inject = ["react", "pages", "host"];

const SALES = "https://sales.sunnn.co/action-items";
const REFRESH_MS = 60000;

const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/></svg>',
  );

const LABEL_COLORS = {
  green: "#4bce97", yellow: "#e2b203", orange: "#faa53d", red: "#f87168",
  purple: "#9f8fef", blue: "#579dff", sky: "#6cc3e0", lime: "#94c748",
  pink: "#e774bb", black: "#8590a2",
};

const line = "1px solid color-mix(in srgb, currentColor 14%, transparent)";
const muted = { opacity: 0.68 };

function labelColor(c) {
  if (!c) return LABEL_COLORS.black;
  if (c.startsWith("#")) return c;
  return LABEL_COLORS[c] || LABEL_COLORS.black;
}

function personName(email) {
  if (!email) return "";
  const local = String(email).split("@")[0];
  if (local === "buzz") return "Buzz";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function initials(email) {
  const n = personName(email);
  return n ? n.slice(0, 2).toUpperCase() : "";
}

function dueInfo(card) {
  const raw = card.dueAt || card.dueDate;
  if (!raw) return null;
  const d = new Date(card.dueAt ? raw : raw + "T17:00:00");
  if (isNaN(d)) return null;
  const now = new Date();
  const days = Math.round((d - now) / 86400000);
  const text = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const tone = d < now ? "overdue" : days <= 1 ? "soon" : "later";
  return { text, tone };
}

function ago(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

export function apply(ctx) {
  const React = ctx.react;
  const h = React.createElement;
  const { useEffect, useMemo, useState, useCallback } = React;

  async function read(req) {
    const out = await ctx.host.runCommand("board-read", JSON.stringify(req));
    if (out == null) throw new Error("Could not reach the board reader");
    const data = JSON.parse(out);
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  function Chip(props) {
    return h(
      "span",
      {
        title: props.title,
        style: {
          display: "inline-block", minWidth: 32, height: 8, borderRadius: 4,
          background: labelColor(props.color),
        },
      },
    );
  }

  function Avatar(props) {
    return h(
      "span",
      {
        title: props.email,
        style: {
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 22, height: 22, borderRadius: 11, fontSize: 10, fontWeight: 600,
          background: "color-mix(in srgb, currentColor 14%, transparent)",
        },
      },
      initials(props.email),
    );
  }

  function CardTile(props) {
    const c = props.card;
    const due = dueInfo(c);
    const labels = Array.isArray(c.labels) ? c.labels : [];
    const selected = props.selected;
    return h(
      "button",
      {
        type: "button",
        className: "ui-card",
        onClick: () => props.onOpen(c),
        style: {
          display: "flex", flexDirection: "column", gap: 6, width: "100%",
          textAlign: "left", padding: "8px 10px", cursor: "pointer",
          borderTop: c.coverColor ? "4px solid " + labelColor(c.coverColor) : undefined,
          outline: selected ? "2px solid var(--color-accent, #579dff)" : "none",
          font: "inherit", color: "inherit",
        },
      },
      labels.length
        ? h("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" } },
            labels.map((l, i) => h(Chip, { key: i, color: l.color, title: l.name })))
        : null,
      h("div", { style: { fontSize: 13.5, lineHeight: 1.35, fontWeight: 500 } }, c.title),
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, flexWrap: "wrap" } },
        due
          ? h("span", {
              style: {
                padding: "1px 6px", borderRadius: 4,
                background: due.tone === "overdue" ? "#c9372c" : due.tone === "soon" ? "#e2b203" : "color-mix(in srgb, currentColor 10%, transparent)",
                color: due.tone === "later" ? "inherit" : due.tone === "soon" ? "#172b4d" : "#fff",
              },
            }, "Due " + due.text)
          : null,
        c.commentCount
          ? h("span", { style: muted, title: "Comments" }, "💬 " + c.commentCount)
          : null,
        // Unread counts belong to the reading identity; the read-only key is not
        // a person, so its counts would show every comment as new. Hidden until
        // the plugin signs in as the viewer.
        c.agentDoneAt ? h("span", { title: "An agent marked this done" }, "✅") : null,
        h("span", { style: { flex: 1 } }),
        c.assignedTo ? h(Avatar, { email: c.assignedTo }) : null,
      ),
    );
  }

  function Column(props) {
    const { list, cards, total } = props;
    return h(
      "section",
      {
        style: {
          flex: "0 0 272px", maxHeight: "100%", display: "flex", flexDirection: "column",
          borderRadius: 12, background: "color-mix(in srgb, currentColor 5%, transparent)",
          border: line,
        },
      },
      h(
        "header",
        { style: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 6px" } },
        h("h3", { style: { margin: 0, fontSize: 13, fontWeight: 650, letterSpacing: 0.2, flex: 1 } }, list.title),
        h("span", { style: { ...muted, fontSize: 12 } }, total > cards.length ? cards.length + " of " + total : cards.length),
      ),
      h(
        "div",
        { style: { overflowY: "auto", padding: "4px 8px 10px", display: "flex", flexDirection: "column", gap: 8 } },
        cards.length
          ? cards.map((c) => h(CardTile, { key: c.id, card: c, onOpen: props.onOpen, selected: props.selectedId === c.id }))
          : h("p", { style: { ...muted, fontSize: 12, margin: "4px 4px" } }, "No cards"),
      ),
    );
  }

  function Detail(props) {
    const c = props.card;
    const [extra, setExtra] = useState(null);
    const [err, setErr] = useState(null);
    useEffect(() => {
      let live = true;
      setExtra(null);
      setErr(null);
      read({ op: "card", id: c.id })
        .then((d) => live && setExtra(d))
        .catch((e) => live && setErr(String(e.message || e)));
      return () => { live = false; };
    }, [c.id]);
    const lists = (extra && extra.checklists && extra.checklists.checklists) || [];
    const items = (extra && extra.checklists && extra.checklists.items) || [];
    const comments = (extra && extra.comments && extra.comments.comments) || [];
    const due = dueInfo(c);
    return h(
      "aside",
      {
        className: "ui-card",
        style: {
          flex: "0 1 380px", minWidth: 280, overflowY: "auto", padding: "var(--space-panel-inset, 16px)",
          display: "flex", flexDirection: "column", gap: 12,
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "flex-start", gap: 8 } },
        h("h2", { style: { margin: 0, fontSize: 17, lineHeight: 1.3, flex: 1 } }, c.title),
        h("button", { type: "button", onClick: props.onClose, "aria-label": "Close" }, "✕"),
      ),
      h(
        "div",
        { style: { display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12.5 } },
        h("span", { style: muted }, "In " + props.listTitle),
        c.assignedTo ? h("span", null, "👤 " + personName(c.assignedTo)) : null,
        due ? h("span", null, "📅 " + due.text) : null,
        c.repName ? h("span", null, "Rep: " + c.repName) : null,
      ),
      c.description
        ? h("div", { style: { whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5 } }, c.description)
        : h("p", { style: { ...muted, fontSize: 13, margin: 0 } }, "No description"),
      err ? h("p", { style: { color: "#f87168", fontSize: 12.5 } }, err) : null,
      !extra && !err ? h("p", { style: { ...muted, fontSize: 12.5 } }, "Loading checklists and comments…") : null,
      lists.map((cl) => {
        const mine = items.filter((i) => i.checklistId === cl.id);
        const done = mine.filter((i) => i.done || i.checked || i.completedAt).length;
        return h(
          "div",
          { key: cl.id },
          h("h3", { style: { margin: "0 0 6px", fontSize: 13.5 } }, (cl.title || "Checklist") + "  " + done + "/" + mine.length),
          mine.map((i) =>
            h("div", { key: i.id, style: { display: "flex", gap: 8, fontSize: 13, padding: "2px 0" } },
              h("span", null, i.done || i.checked || i.completedAt ? "☑" : "☐"),
              h("span", { style: i.done || i.checked || i.completedAt ? { ...muted, textDecoration: "line-through" } : null }, i.title || i.text),
            ),
          ),
        );
      }),
      extra
        ? h(
            "div",
            null,
            h("h3", { style: { margin: "0 0 6px", fontSize: 13.5 } }, "Comments (" + comments.length + ", newest first)"),
            comments.slice(0, 20).map((m) =>
              h(
                "div",
                { key: m.id, style: { borderTop: line, padding: "8px 0", fontSize: 13 } },
                h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 4 } },
                  h(Avatar, { email: m.authorEmail }),
                  h("strong", null, personName(m.authorEmail)),
                  h("span", { style: { ...muted, fontSize: 11.5 } }, ago(m.createdAt)),
                ),
                h("div", { style: { whiteSpace: "pre-wrap", lineHeight: 1.45, overflowWrap: "anywhere" } },
                  String(m.body || "").slice(0, 700) + (String(m.body || "").length > 700 ? "…" : "")),
              ),
            ),
          )
        : null,
      h("a", { href: SALES + "?board=" + props.boardId, target: "_blank", rel: "noreferrer", style: { fontSize: 12.5 } }, "Open in sales.sunnn.co ↗"),
    );
  }

  function BoardPage() {
    const [boards, setBoards] = useState([]);
    const [boardId, setBoardId] = useState(null);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [query, setQuery] = useState("");
    const [openId, setOpenId] = useState(null);
    const [stamp, setStamp] = useState(null);

    useEffect(() => {
      read({ op: "boards" })
        .then((d) => {
          const bs = (d.boards || []).slice().sort((a, b) => a.position - b.position);
          setBoards(bs);
          setBoardId((cur) => cur || (bs[0] && bs[0].id) || null);
        })
        .catch((e) => setError(String(e.message || e)));
    }, []);

    const load = useCallback(() => {
      if (!boardId) return;
      read({ op: "board", boardId })
        .then((d) => { setData(d); setError(null); setStamp(new Date()); })
        .catch((e) => setError(String(e.message || e)));
    }, [boardId]);

    useEffect(() => {
      setData(null);
      setOpenId(null);
      load();
      const t = setInterval(load, REFRESH_MS);
      return () => clearInterval(t);
    }, [load]);

    const columns = useMemo(() => {
      if (!data) return [];
      const q = query.trim().toLowerCase();
      const lists = (data.lists || []).slice().sort((a, b) => a.position - b.position);
      return lists.map((l) => {
        let cards = data.cards.filter((c) => c.listId === l.id);
        if (q) cards = cards.filter((c) => (c.title + " " + (c.description || "")).toLowerCase().includes(q));
        cards.sort((a, b) => a.position - b.position);
        const total = (data.totals && data.totals[l.id]) || cards.length;
        return { list: l, cards, total: q ? cards.length : total };
      });
    }, [data, query]);

    const openCard = data && openId ? data.cards.find((c) => c.id === openId) : null;
    const openList = openCard ? (data.lists.find((l) => l.id === openCard.listId) || {}).title : "";
    const openCount = data ? data.cards.filter((c) => !(data.totals && data.totals[c.listId] != null)).length : 0;

    return h(
      "div",
      {
        style: {
          height: "100%", display: "flex", flexDirection: "column", gap: 12,
          padding: "var(--space-panel-inset, 16px)", boxSizing: "border-box", minHeight: 0,
        },
      },
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
        h("h1", { style: { margin: 0, fontSize: 20 } }, "Project board"),
        h(
          "div",
          { role: "tablist", style: { display: "flex", gap: 4, flexWrap: "wrap" } },
          boards.map((b) =>
            h(
              "button",
              {
                key: b.id, type: "button", role: "tab", "aria-selected": b.id === boardId,
                onClick: () => setBoardId(b.id),
                style: {
                  padding: "4px 10px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                  border: line, font: "inherit", color: "inherit",
                  background: b.id === boardId ? "color-mix(in srgb, currentColor 16%, transparent)" : "transparent",
                  fontWeight: b.id === boardId ? 600 : 400,
                },
              },
              b.title,
            ),
          ),
        ),
        h("span", { style: { flex: 1 } }),
        h("input", {
          type: "search", placeholder: "Search cards", value: query,
          onChange: (e) => setQuery(e.target.value),
          style: { padding: "5px 10px", borderRadius: 8, border: line, background: "transparent", color: "inherit", font: "inherit", fontSize: 13, minWidth: 160 },
        }),
        h("button", { type: "button", onClick: load, title: "Refresh" }, "↻"),
      ),
      h(
        "div",
        { style: { ...muted, fontSize: 12 } },
        data ? openCount + " open cards · read-only preview · updated " + (stamp ? stamp.toLocaleTimeString() : "") : "Loading board…",
        error ? h("span", { style: { color: "#f87168", marginLeft: 8, opacity: 1 } }, error) : null,
      ),
      h(
        "div",
        { style: { flex: 1, minHeight: 0, display: "flex", gap: 12 } },
        h(
          "div",
          { style: { flex: 1, minWidth: 0, display: "flex", gap: 12, overflowX: "auto", alignItems: "flex-start", paddingBottom: 8 } },
          columns.map((col) =>
            h(Column, { key: col.list.id, list: col.list, cards: col.cards, total: col.total, onOpen: (c) => setOpenId(c.id), selectedId: openId }),
          ),
        ),
        openCard
          ? h(Detail, { card: openCard, listTitle: openList, boardId, onClose: () => setOpenId(null) })
          : null,
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
