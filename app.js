/* Voidship Roster. Data: the server's /api/data when served by serve.py (decisions enabled), else the baked
   window.ROSTER from data.js (read-only). Source of truth: campaign/content/voidships/vessels/*.json and the
   corpus; this page never stores anything itself except view settings in localStorage. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const TOKEN = (document.querySelector('meta[name="voidship-token"]') || {}).content || null;
  const API = !!TOKEN && location.protocol.startsWith("http");
  let R = window.ROSTER || null;

  const CAT_LABEL = { GC: "Grand cruiser", BC: "Battlecruiser", C: "Cruiser", LC: "Light cruiser", F: "Frigate", R: "Raider", T: "Transport", U: "Unique or unknown hull size (no standard class)" };
  const LOC_LABEL = { unslotted: "Weapons without a free slot", essential: "Essential", prow: "Prow", dorsal: "Dorsal", port: "Port", starboard: "Starboard", keel: "Keel", aft: "Aft", supplemental: "Supplemental", hull: "Hull" };
  const QUALITY = { best: "Best", good: "Good", poor: "Poor" };
  const EXTRA_LABEL = { upgrade: "Upgrade", background: "Background package", machine_spirit_oddity: "Machine Spirit Oddity", past_history: "Past History",
    complication: "Machine Spirit Oddity", history: "Past History" };
  const STAT_LABEL = { speed: "Speed", manoeuvrability: "Manoeuvrability", detection: "Detection", armour: "Armour", shields: "Shields", turrets: "Turrets", integrity: "Hull Integrity", morale: "Morale", population: "Crew Population" };
  const FIELD_LABEL = { power: "Power", power_generated: "Power generated", space: "Space", strength: "Strength", damage: "Damage", crit: "Crit", range: "Range" };
  const STATUS_LABEL = { pending: "Needs review", quality: "Within quality range — approve?", custom: "Custom variant", deferred: "Deferred", merged: "Uses record", changed: "Record changed since decided" };
  const CHECK_LABEL = { slot: "Weapon slot", eligibility: "Hull class", capacity: "Weapon capacity", specified: "Unique vessel loadout", complication_limit: "One of each complication", essential_missing: "Essential component missing" };
  const SOURCES = [["all", "All vessels"], ["book", "From the books"], ["copy", "My copies of book ships"], ["custom", "My custom"]];
  const state = { tags: new Set(), showDetails: true, cShowCustom: true, cShowStubs: true, cgroup: "all", cclass: "", csrc: "all", cflag: "",  csort: {}, tab: "vessels", msrc: "all", mcond: true, factions: new Set(), cats: new Set(), source: "all", unique: "all", hullClass: "", sort: "name", desc: false, house: true, q: "", review: false };
  const PUBLIC = !!(R && R.public);                             // the website edition (publish.py): read-only, no GM tools
  const VIEW_KEY = PUBLIC ? "voidship-public-view" : "roster-view";
  try {
    let s = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}");
    if (PUBLIC) s = Object.fromEntries(Object.entries({ sort: s.sort, desc: s.desc, showDetails: s.showDetails, tab: s.tab === "cat" ? "cat" : "vessels" })
      .filter(([, x]) => x !== undefined));                       // never a stale filter
    s.q = "";                                                    // a search is never restored: an invisible one hid every ship (2026-11-11)
    Object.assign(state, s, { factions: new Set(s.factions || []), cats: new Set(s.cats || []), tags: new Set(s.tags || []), focus: null, viewVersion: 3 });
  } catch (e) { /* no storage */ }
  const persistView = () => { const f = state.focus; persist(); state.focus = f; };   // a display setting, not a filter
  const persist = () => {                                         // any filter change also ends a "your new ship" view
    state.focus = null;
    try { localStorage.setItem(VIEW_KEY, JSON.stringify(Object.assign({}, state, { factions: [...state.factions], cats: [...state.cats], tags: [...state.tags], focus: null, q: "" }))); } catch (e) { /* ignore */ }
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (n) => (n == null || n === "" ? "—" : n);

  // ---- deviations
  const st = (d) => (d.record_changed ? "changed" : d.status === "pending" && d.within_quality ? "quality" : d.status);
  const worst = (devs) => {
    if (!devs || !devs.length) return null;
    const s = devs.map(st);
    for (const k of ["changed", "pending", "quality", "deferred", "custom", "merged"]) if (s.includes(k)) return k;
    return null;
  };
  function devsFor(v, sel) {
    const all = v.deviations || [];
    if (sel.uid) return all.filter((d) => ["component", "slot", "eligibility"].includes(d.kind) && d.uid === sel.uid);
    if (sel.index != null) return all.filter((d) => ["book_weapon", "book_slot", "book_eligibility"].includes(d.kind) && d.component_index === sel.index);
    if (sel.stat) return all.filter((d) => (d.kind === "stat" || d.kind === "book_hull" || d.kind === "book_swap") && d.field === sel.stat);
    if (sel.hull) return all.filter((d) => d.kind === "hull");
    if (sel.loadout) return all.filter((d) => d.kind === "loadout");
    if (sel.capacity) return all.filter((d) => d.kind === "capacity" || d.kind === "book_capacity");
    if (sel.specified) return all.filter((d) => d.kind === "specified" || d.kind === "book_specified");
    if (sel.climit) return all.filter((d) => d.kind === "complication_limit" || d.kind === "book_complication_limit");
    if (sel.essential) return all.filter((d) => (d.kind === "essential_missing" || d.kind === "book_essential_missing") && d.role === sel.essential);
    return [];
  }
  const isPub = (v) => !!((R.publish || {})[v.vessel_id || v.id] || {}).publish;   // flagged for the website (GM, opt-in)
  const liveVessels = () => (R.vessels || []).filter((v) => !v.dropped || state.showDropped);   // dropped ships only on request
  const openCount = (v) => (v.deviations || []).filter((d) => d.status === "pending" || d.record_changed).length + (v.alias_reviews || []).length;

  function stats(v) {
    const s = Object.assign({}, v.stats), ruled = {};
    if (state.house && v.stats_basis === "book") {
      if (typeof s.armour === "number") { s.armour = Math.max(0, s.armour - R.house_rules.armour_minus); ruled.armour = v.stats.armour; }
      if (typeof s.shields === "number") { s.shields = s.shields * R.house_rules.shields_times; ruled.shields = v.stats.shields; }
    }
    return { s, ruled };
  }
  const spaceRem = (v) => v.space_remaining;
  const SORTS = { name: (v) => (v.name || "").toLowerCase(), space_total: (v) => v.space_total == null ? -1 : v.space_total,
    space_remaining: (v) => spaceRem(v) == null ? -1e9 : spaceRem(v), weapon_slots: (v) => v.weapon_slots || 0, review: (v) => openCount(v) };

  function matches(v, skip) {                                   // skip: the facet being counted (its own filter is ignored)
    if (state.focus && !skip) return (v.vessel_id || v.id) === state.focus.id;
    if (skip !== "faction" && state.factions.size && !state.factions.has(v.faction)) return false;
    if (skip !== "tags" && state.tags.size && !(state.tags.has("__notag__") && !(v.tags || []).length) && !(v.tags || []).some((t) => state.tags.has(t))) return false;
    if (skip !== "cat" && state.cats.size && !state.cats.has(v.category)) return false;
    if (skip !== "source" && state.source !== "all" && v.source !== state.source) return false;
    if (skip !== "hullClass" && state.hullClass && (state.hullClass === "\u0000none" ? !!v.hull_class_name : v.hull_class_name !== state.hullClass)) return false;
    if (skip !== "unique" && state.unique !== "all" && !!(v.unique && v.unique.unique) !== (state.unique === "unique")) return false;
    if (skip !== "review" && state.review && !openCount(v)) return false;
    if (skip !== "pub" && state.pub && state.pub !== "all" && isPub(v) !== (state.pub === "pub")) return false;
    if (state.q) {
      const hay = [v.name, v.hull, v.hull_class_name, v.faction, v.book_name, v.affiliation, v.captain, v.based_on_name].concat(v.components.map((c) => c.name), v.tags || [], v.names || [], [v.description || ""]).join(" ").toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }
  const pool = (skip) => liveVessels().filter((v) => matches(v, skip));   // the ships a facet's numbers count

  function chipRow(el, values, set, label, counts) {
    el.innerHTML = values.map((x) => `<button class="chip" data-k="${esc(x)}" aria-pressed="${set.has(x)}">${esc(label(x))}<span class="n">${counts[x] || 0}</span></button>`).join("");
    el.onclick = (e) => { const b = e.target.closest("[data-k]"); if (!b) return; const k = b.dataset.k; set.has(k) ? set.delete(k) : set.add(k); persist(); render(); };
  }
  function sourceRow() {
    if (PUBLIC) { $("#f-source").innerHTML = ""; return; }      // no book / campaign split on the website (GM 2026-11-13)
    const opts = R.public ? [["all", "All vessels"], ["book", "Book ships"], ["campaign", "Campaign ships"]] : SOURCES;
    const el = $("#f-source");
    const sp = pool("source"), sn = (k) => (k === "all" ? sp.length : sp.filter((v) => v.source === k).length);
    el.innerHTML = opts.map(([k, l]) => `<button class="chip" data-s="${k}" aria-pressed="${state.source === k}">${l}<span class="n">${sn(k)}</span></button>`).join("")
      + (R.public ? "" : `<button class="chip" id="f-review" aria-pressed="${state.review}">Needs review<span class="n">${pool("review").filter(openCount).length}</span></button>`)
      + (API ? `<span class="pubchips"><button class="chip" data-pubf="pub" aria-pressed="${state.pub === "pub"}" title="Ships you publish to the website">Published<span class="n">${pool("pub").filter(isPub).length}</span></button><button class="chip" data-pubf="priv" aria-pressed="${state.pub === "priv"}" title="Ships kept off the website">Private<span class="n">${pool("pub").filter((v) => !isPub(v)).length}</span></button>`
        + `<button class="chip" id="pubbulk" title="Publish or unpublish every ship shown">Publish the shown…</button></span>` : "");
    el.onclick = (e) => {
      if (e.target.closest("#f-review")) { state.review = !state.review; persist(); return render(); }
      const pf = e.target.closest("[data-pubf]"); if (pf) { state.pub = state.pub === pf.dataset.pubf ? "all" : pf.dataset.pubf; persist(); return render(); }
      if (e.target.closest("#pubbulk")) return pubBulk();
      const b = e.target.closest("[data-s]"); if (!b) return; state.source = b.dataset.s; persist(); render();
    };
  }

  function uniqueRow() {
    const el = $("#f-unique"), all = pool("unique");
    const n = (u) => all.filter((v) => !!(v.unique && v.unique.unique) === u).length;
    const opts = [["all", "Unique vessels and subtypes", all.length], ["unique", "Unique vessels", n(true)], ["class", "Vessel subtypes", n(false)]];
    el.innerHTML = opts.map(([k, l, c]) => `<button class="chip" data-u="${k}" aria-pressed="${state.unique === k}">${l}<span class="n">${c}</span></button>`).join("");
    el.onclick = (e) => { const b = e.target.closest("[data-u]"); if (!b) return; state.unique = b.dataset.u; persist(); render(); };
  }
  function hullClassPicker() {
    const el = $("#f-hullclass");
    const hp = pool("hullClass");
    const n = {}; let none = 0;
    hp.forEach((v) => { if (v.hull_class_name) n[v.hull_class_name] = (n[v.hull_class_name] || 0) + 1; else none++; });
    const names = Object.keys(n).sort((a, b) => a.localeCompare(b));
    if (state.hullClass && state.hullClass !== "\u0000none" && !n[state.hullClass]) names.push(state.hullClass);   // keep the choice visible
    const opt = (k, l) => `<option value="${esc(k)}"${state.hullClass === k ? " selected" : ""}>${esc(l)}</option>`;
    const named = names.filter((x) => /-class$/.test(x)), other = names.filter((x) => !/-class$/.test(x));
    el.innerHTML = opt("", `All classes (${hp.length})`)
      + (named.length ? `<optgroup label="Named classes">${named.map((x) => opt(x, `${x} (${n[x] || 0})`)).join("")}</optgroup>` : "")
      + (other.length ? `<optgroup label="Other classifications">${other.map((x) => opt(x, `${x} (${n[x] || 0})`)).join("")}</optgroup>` : "")
      + (none ? opt("\u0000none", `No named class (${none})`) : "");
  }
  function uniqueBadge(v, i) {
    const u = v.unique; if (!u) return "";
    const label = u.unique ? "Unique" : "Subtype", tip = `${u.unique ? "A unique, named vessel: every component must be specified." : "A vessel subtype: its members can take generated names, and the loadout may vary."} ${u.confirmed ? "" : "(Proposed; click to confirm.) "}${u.why}`;
    const click = !R.public && (API || !u.confirmed) ? ` tabindex="0" role="button" data-v="${i}" data-sel='{"unique":true}'` : "";
    return `<span class="badge uqb ${u.unique ? "uq-u" : "uq-c"}${u.confirmed ? "" : " proposed"}" title="${esc(tip)}"${click}>${label}${u.confirmed ? "" : " ?"}</span>`;
  }
  function meter(label, used, total, rem, unit, devAttr) {
    const dev = devAttr ? ` ${devAttr}` : "";
    if (total == null) return `<div class="meter"${dev}><span>${label}</span><span class="track"></span><span class="v">— no ${unit} total</span></div>`;
    const r = rem != null ? rem : total - used, pct = total > 0 ? Math.min(100, Math.max(0, 100 * (total - r) / total)) : 0;
    return `<div class="meter${r < 0 ? " over" : ""}"${dev}><span>${label}</span><span class="track"><i style="width:${pct}%"></i></span><span class="v">${fmt(total - r)} / ${fmt(total)} · ${fmt(r)} left</span></div>`;
  }

  function groupComponents(v) {
    const groups = [], order = ["hull", "essential", "prow", "dorsal", "port", "starboard", "keel", "aft", "unslotted"];
    v.components.forEach((c, idx) => {
      const k = c.kind === "hull" ? "hull" : (LOC_LABEL[c.location] ? c.location : (c.kind === "essential" ? "essential" : "supplemental"));
      let g = groups.find((x) => x.k === k); if (!g) groups.push((g = { k, items: [] })); g.items.push([c, idx]);
    });
    const add = (k, item) => { let g = groups.find((x) => x.k === k); if (!g) groups.push((g = { k, items: [] })); g.items.push([item, -1]); };
    (v.deviations || []).filter((d) => d.role && /essential_missing$/.test(d.kind)).forEach((d) => add("essential", { empty: "essential", role: d.role, status: d.status }));
    (v.empty_slots || []).forEach((e) => { for (let n = 0; n < e.count; n++) add(e.location, { empty: "weapon", location: e.location }); });
    const rank = (k) => (order.indexOf(k) === -1 ? 9 : order.indexOf(k));
    const g = groups.find((x) => x.k === "supplemental");        // supplementary components: alphabetical (re-sorted on every render,
    if (g) g.items.sort(([a], [b]) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true }));   // so after each change)
    return groups.sort((a, b) => rank(a.k) - rank(b.k));
  }

  const cardOpen = (v) => { const o = (state.cardOpen || {})[v.vessel_id || v.id]; return o === undefined ? state.showDetails !== false : o; };
  document.addEventListener("click", (e) => {                   // one card's show/hide (until the global toggle is used again)
    const b = e.target.closest("[data-cardtoggle]"); if (!b) return;
    e.stopPropagation();
    const open = b.getAttribute("aria-expanded") !== "true";
    state.cardOpen = Object.assign({}, state.cardOpen, { [b.dataset.cardtoggle]: open });
    persistView();
    b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "▾ Hide components" : "▸ Show components";
    const body = b.nextElementSibling; if (body) body.hidden = !open;
  }, true);
  function card(v, i) {
    const { s, ruled } = stats(v);
    const st = [["Speed", "speed"], ["Man.", "manoeuvrability"], ["Det.", "detection"], ["Armour", "armour"], ["Shields", "shields"],
      ["Turrets", "turrets"], ["Integrity", "integrity"], ["Morale", "morale"], ["Crew pop.", "population"], ["Crew", v.stats_basis === "book" ? "crew" : "crew_value"]];
    const statHTML = st.map(([l, k]) => {
      const w = worst(devsFor(v, { stat: k }));
      const rc = (v.stat_recalc || {})[k];
      const sw = (v.stat_swaps || {})[k] || (rc && rc.card !== rc.now ? { book: rc.card, now: rc.now, by: rc.rows.map((r) => `${r.label} ${r.value}`), rc: true } : null);
      const cls = (ruled[k] != null ? " ruled" : "") + (w ? ` dev dev-${w}` : "") + (sw && !w ? " swap" : "");
      const work = (v.stat_working || {})[k];
      const tipText = [(v.stat_defaults || []).includes(k) ? `${v.detached ? "Not set" : "Not printed / not on the card"}: the default ${fmt(s[k])}` : null, w ? STATUS_LABEL[w] : null, sw ? (sw.rc ? `${v.detached ? "Was" : "On the card"} ${fmt(sw.book)}; recalculated ${fmt(sw.now)}:\n${sw.by.join("\n")}` : `Book value ${fmt(sw.book)}; ${fmt(sw.now)} after your swap: ${sw.by.join("; ")}`) : null, ruled[k] != null ? `${sw ? "Value" : "Book value"} before the house rule: ${ruled[k]}` : null, work ? `Hull + components: ${work}` : null,
        (v.stats_changed_now || []).includes(k) ? "Changed now: a component that affects it isn't working." : null].filter(Boolean).join("\n");
      const attrs = (w ? ` tabindex="0" role="button" data-v="${i}" data-sel='${JSON.stringify({ stat: k })}'` : "") + (tipText ? ` title="${esc(tipText)}"` : "");
      const pl = (v.pools || {})[k];                             // Integrity, Morale, Crew Population: current / max (GM 2026-11-13)
      if (pl) {
        const canSet = API && !v.dropped && v.unique && v.unique.unique;
        const ptip = `Current ${pl.current} of ${pl.max}${pl.from === "card" ? " (the current value on your card)" : pl.from === "gm" ? " (set by you)" : ""}`;
        return `<div class="stat pool${cls}${pl.current < pl.max ? " hurt" : ""}${(v.stats_changed_now || []).includes(k) ? " now" : ""}"${attrs.replace(/ title="[^"]*"/, "")} title="${esc(ptip + (tipText ? "\n" + tipText : ""))}"><b>${l}</b><span>${esc(fmt(pl.current))}<small>/${esc(fmt(pl.max))}</small>${canSet ? `<button class="curset" data-cur="${i}" data-stat="${k}" aria-label="Set the current ${esc(l)}" title="Set the current value">✎</button>` : ""}</span></div>`;
      }
      return `<div class="stat${cls}${(v.stats_changed_now || []).includes(k) ? " now" : ""}"${attrs}><b>${l}</b><span>${esc(fmt(s[k]))}</span></div>`;
    }).join("");
    const cw = worst(devsFor(v, { capacity: true }));
    const capW = v.weapon_capacity || {}, usedW = {};              // weapon slots: used / the hull's capacity
    v.components.forEach((c) => { if (["prow", "dorsal", "port", "starboard", "keel", "aft"].includes(c.location)) usedW[c.location] = (usedW[c.location] || 0) + 1; });
    const slotLocs = ["prow", "dorsal", "port", "starboard", "keel", "aft"].filter((l) => capW[l] || usedW[l]);
    const slots = (slotLocs.map((l) => {
      const u = usedW[l] || 0, cp = capW[l];
      const cls = cp == null ? "" : u < cp ? " free" : u > cp ? " over" : "";
      return `<span class="slot${cls}" title="${esc(LOC_LABEL[l] || l)}: ${u} weapon${u === 1 ? "" : "s"} fitted${cp != null ? ` of ${cp} the hull allows` : " (the hull's capacity isn't on record)"}">${esc(LOC_LABEL[l] || l)} ${u}${cp != null ? "/" + cp : ""}</span>`;
    }).join("") || `<span class="slot">no weapon slots listed</span>`)
      + (cw ? ` <span class="slot dev dev-${cw}" tabindex="0" role="button" data-v="${i}" data-sel='{"capacity":true}'>over capacity</span>` : "");
    const comps = groupComponents(v).map((g) => `<div class="loc">${esc(LOC_LABEL[g.k] || g.k)}</div>` + g.items.map(([c, idx]) => {
      if (c.empty === "essential") {                            // no component fills this essential role
        const kept = c.status === "custom" || c.status === "deferred";
        return `<div class="comp emptyslot${kept ? " kept" : " dev dev-pending"}"><span class="nm">${API ? `<button class="linkbtn" data-pick="${i}" data-picktab="component" data-pickrole="${esc(c.role)}" title="Fit a ${esc(c.role)}">Empty: ${esc(c.role)} ＋</button>` : `Empty: ${esc(c.role)}`}${kept ? ` <span class="note">(${c.status === "custom" ? "kept empty" : "deferred"})</span>` : ""}${API ? ` <button class="linkbtn subtle" data-v="${i}" data-sel='${JSON.stringify({ essential: c.role })}' title="Keep it empty (e.g. a ship that has no ${esc(c.role)}) or defer">review…</button>` : ""}</span><span></span><span class="p">—</span><span class="s">—</span>${API ? "<span></span>" : ""}</div>`;
      }
      if (c.empty === "weapon") {                               // a weapon slot the hull has and no weapon fills
        return `<div class="comp emptyslot"><span class="nm">${API ? `<button class="linkbtn" data-pick="${i}" data-picktab="component" data-pickloc="${esc(c.location)}" title="Fit a weapon in this ${esc(LOC_LABEL[c.location] || c.location)} slot">Empty ${esc((LOC_LABEL[c.location] || c.location).toLowerCase())} slot ＋</button>` : `Empty ${esc(LOC_LABEL[c.location] || c.location)} slot`}</span><span></span><span class="p">—</span><span class="s">—</span>${API ? "<span></span>" : ""}</div>`;
      }
      const sel = c.uid ? { uid: c.uid } : { index: idx };
      const w = worst(devsFor(v, sel));
      const alias = c.alias_suggestions && c.alias_suggestions.length;
      const known = c.ref && !String(c.ref).startsWith("custom:");
      const ci = String(c.ref || "").startsWith("ci:");
      const wp = weaponLine(v, c);
      const p = c.power_generated != null ? `<span class="p gen" title="Power generated">+${esc(c.power_generated)}</span>` : `<span class="p">${esc(fmt(c.power))}</span>`;
      const q = c.mark ? `<span class="q q-mark" title="Your card marks this component '${esc(c.mark)}' (not a quality letter)">${esc(c.mark)}</span>` : "";
      const craft = craftCell(v, i, c, idx);
      const vr = c.variable;
      const pv = vr ? `<span class="p var" title="${esc(`Variable ${vr.field}: ${vr.min}–${vr.max}. ${vr.effect || ""}`)}">${API && v.source !== "book" ? `<button class="step" data-step="-1" data-v="${i}" data-uid="${esc(c.uid)}" aria-label="Less power" ${vr.value <= vr.min ? "disabled" : ""}>−</button>` : ""}${esc(fmt(vr.value))}${API && v.source !== "book" ? `<button class="step" data-step="1" data-v="${i}" data-uid="${esc(c.uid)}" aria-label="More power" ${vr.value >= vr.max ? "disabled" : ""}>+</button>` : ""}</span>` : null;
      const spell = !w && !alias && c.spelling_differs && API && v.source !== "book";
      const build = API && v.source !== "book" && c.uid && c.kind !== "hull";
      const stEdit = API && c.kind !== "hull" && (v.source === "book" ? c.index != null : !!c.uid);
      const adj = adjOf(v, c);
      const sts = c.statuses || [];
      const cls = ["comp", c.virtual ? "virtual" : "", w ? `dev dev-${w}` : "", alias ? "alias" : "", spell ? "spell" : "", adj.length ? "adj" : "", ...sts.map((s) => "is-" + s)].join(" ");
      const title = w ? STATUS_LABEL[w] : alias ? "Possible misspelling of a book component" : spell ? `Spelled differently from the record: ${c.record_name}` : "";
      const cur = (c.statuses || [])[0] || "intact", more = (c.statuses || []).length > 1;
      const stsel = stEdit ? `<button class="stbtn st-${esc(cur)}" data-v="${i}" data-uid="${esc(c.uid || "")}" data-idx="${c.index != null ? c.index : ""}" data-cur="${esc(cur)}"
        aria-label="Status of ${esc(c.name)}: ${esc(c.state || "Intact")}. Click for the next status" title="${esc(c.state || "Intact")} · click: next status · shift-click: previous">${STATUS_SHORT[cur]}${more ? "+" : ""}</button>` : "";
      return `<div class="${cls}${stEdit ? " has-st" : ""}" tabindex="0" data-v="${i}" data-c="${idx}"${(w || alias || spell || build || (API && (c.linkable || stEdit))) ? ` role="button" data-sel='${JSON.stringify(sel)}'` : ""} title="${esc(title || (API && stEdit ? "Click to replace it with a component from the catalogue" : ""))}"><span class="nm${known ? "" : " unresolved"}">${c.linkable ? `<span class="tag-ci tag-link" title="Not linked to a record: click to link it">link?</span>` : ""}${q}${esc(c.name)}${ci ? CI_TAG : ""}${c.built_in ? `<span class="tag-ci tag-hull" title="Built into the ${esc(c.built_in.hull || "hull")}: its Space is already in the hull's Space${c.built_in.power != null ? `; it needs ${c.built_in.power} Power` : ""}${c.virtual ? ". Not listed on the card or stat block; shown because the hull comes with it" : ""}">built-in</span>` : ""}${adj.length ? `<span class="adjmark" title="${esc(adj.join("\n"))}">⇄</span>` : ""}${c.required ? `<span class="tag-ci tag-hull" title="${esc(`Required by the ${c.required.hull || "hull"} (${c.required.rule || "GM ruling"}). It costs its own Space and Power.${c.virtual ? " Not on the card or stat block; added because the hull requires it." : ""}\n\n${c.required.text || ""}`)}">required</span>` : ""}${c.is_modification ? `<span class="tag-ci tag-mod" title="A modification printed as its own component: it has no host to modify. Fit it to a component (click the Craft. letter of that component).">modification</span>` : ""}${c.ref && (R.components[c.ref] || {}).gm_errata ? `<span class="tag-ci tag-err" title="A GM erratum applies to this book component">erratum</span>` : ""}${stEdit ? "" : sts.map((s) => `<span class="st st-${s}">${esc(STATUS_NAME[s] || s)}</span>`).join("")}${API && !c.virtual && (c.uid || c.index != null) ? `<button class="rmbtn" data-rm="component" data-v="${i}" data-uid="${esc(c.uid || "")}" data-idx="${c.index != null ? c.index : ""}"${c.added_n ? ` data-added="${c.added_n}"` : ""} data-name="${esc(c.name)}" aria-label="Remove ${esc(c.name)}" title="Remove from this ship">✕</button>` : ""}</span>${craft}${pv || p}<span class="s">${c.kind === "hull" ? "" : esc(fmt(c.space))}</span>${API ? (stsel || "<span></span>") : ""}${wp}</div>` + modRowsHTML(v, i, c, idx);
    }).join("")).join("");
    const HISTORYISH = ["background", "machine_spirit_oddity", "past_history", "history", "complication"];
    const histHidden = [];                                     // shown on every ship since 2026-11-13 (GM: G4NT's were invisible)
    const extras = (v.extras || []).map((e, j) => {
      if (histHidden.includes(e)) return "";                   // only unique vessels show backgrounds, histories, complications
      const alias = e.alias_suggestions && e.alias_suggestions.length;
      const qsel = API && v.source !== "book" && e.kind === "upgrade" && e.uid
        ? `<select class="uq" data-v="${i}" data-u="${esc(e.uid)}" aria-label="Craftsmanship of ${esc(e.name)}">${["poor", "common", "good", "best"].map((q) => `<option value="${q}"${(e.quality || "common") === q ? " selected" : ""}>${q === "common" ? "Common" : QUALITY[q]}</option>`).join("")}</select>` : "";
      const eff = e.quality_effect ? `<span class="wp qe">${esc([].concat(e.quality_effect).join(" "))}</span>` : e.quality_note ? `<span class="wp qe">${esc(e.quality_note)}</span>` : "";
      return `<div class="comp extra${alias ? " alias" : ""}" tabindex="0" data-v="${i}" data-x="${j}"${alias ? ` role="button" data-sel='${JSON.stringify({ upgrade: e.uid })}' title="Possible misspelling"` : ""}><span class="nm${e.ref ? "" : " unresolved"}"><span class="kind">${esc(EXTRA_LABEL[e.kind] || e.kind)}</span>${!qsel && e.quality ? `<span class="q q-${esc(e.quality)}">${esc(QUALITY[e.quality])}</span>` : ""}${esc(e.name)}${e.custom ? CI_TAG : ""}</span><span class="uqcell">${qsel}</span><span>${API && (e.uid || v.source === "book") ? `<button class="rmbtn" data-rm="extra" data-v="${i}" data-uid="${esc(e.uid || "")}" data-ref="${esc(e.ref || "")}"${e.added_n ? ` data-added="${e.added_n}"` : ""} data-kind="${esc((EXTRA_LABEL[e.kind] || e.kind || "entry").toLowerCase())}" data-name="${esc(e.name)}" aria-label="Remove ${esc(e.name)}" title="Remove from this ship">✕</button>` : ""}</span>${eff}</div>`;
    }).join("");
    const mods = v.modifiers || [];
    const tally = Object.entries(v.modifier_tally || {}).map(([k, d]) => `<span class="slot">${esc(STAT_LABEL[k] || k)} ${d > 0 ? "+" : ""}${esc(d)}</span>`).join("");
    const modHTML = mods.length ? `<details class="mods"><summary>Modifiers (${mods.length})</summary>
      ${v.source === "book" ? `<p class="note">The book's stat line already includes its components' effects; component modifiers are listed for reference and not counted in the totals.</p>` : ""}
      ${tally ? `<div class="slots">${tally}</div>` : ""}
      ${mods.map((m) => `<p class="mod"><b>${esc(m.source)}</b> ${esc(m.text)}${m.parsed && m.parsed.length ? ` <span class="parsed">${m.parsed.map((p) => esc(p.stat + (p.set != null ? " = " + p.set : " " + (p.delta > 0 ? "+" : "") + p.delta))).join(" · ")}</span>` : ""}</p>`).join("")}</details>` : "";
    const kwEdit = API;
    const special = (v.special || []).filter((x) => x.name || x.text).map((x, n) => `<p><b>${esc(x.name || "")}</b>${x.fluff ? ` <i>${esc(x.fluff)}</i>` : ""}${x.text ? " " + esc(x.text) : ""}${x.text_original && x.text !== x.text_original ? `<span class="adjmark" title="Your edit; the book prints: ${esc(x.text_original)}">⇄</span>` : ""}${API && (v.source === "book" || x.keyword) ? ` <button class="rmbtn" data-rm="keyword" data-v="${i}"${x.added_n ? ` data-added="${x.added_n}"` : ""} data-name="${esc(x.name)}" aria-label="Remove ${esc(x.name)}" title="Remove from this ship">✕</button>` : ""}</p>`).join("")
      + (v.abilities || []).map((a) => `<p>${esc(a)}</p>`).join("")
      + (API ? `<button class="linkbtn" data-pick="${i}" data-picktab="keyword">＋ Add a special rule…</button>` : "");
    const src = PUBLIC ? "" : v.source === "book" ? `${esc(v.book_name)}${v.page ? ", p" + v.page : ""}`
      : `${v.source === "copy" ? `Your copy of ${esc(v.based_on_name || "a book ship")} · ` : ""}sheet ${esc(v.sheet || "—")}${v.affiliation ? " · " + esc(v.affiliation) : ""}`;
    const hw = worst(devsFor(v, { hull: true }));
    const lw = worst(devsFor(v, { loadout: true }));
    const sw = worst(devsFor(v, { specified: true }));
    const climW = worst(devsFor(v, { climit: true }));
    const counts = v.deviation_counts || {};
    const review = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `<span class="badge revbadge st-${k}">${n} ${esc((STATUS_LABEL[k] || k).toLowerCase())}</span>`).join("")
      + ((v.alias_reviews || []).length ? `<span class="badge revbadge st-alias">${v.alias_reviews.length} possible misspelling${v.alias_reviews.length > 1 ? "s" : ""}</span>` : "");
    const badge = v.source === "book" ? esc(v.book) : v.source === "copy" ? "Copy" : v.source === "campaign" ? "Campaign" : "Custom";
    return `<article class="card ${v.source}${v.dropped ? " dropped" : ""}">${v.dropped ? `<div class="dropbar">Dropped from the roster <button class="act" data-drop="restore" data-v="${i}">Restore</button></div>` : ""}
      <div class="badges">${API ? `<button class="badge cat badgebtn" data-cls="${i}" title="${esc(CAT_LABEL[v.category])}${v.category_override ? " (your reclassification)" : ""} · click to reclassify">${v.category === "U" ? "Unique hull" : v.category}${v.category_override ? "*" : ""}</button>` : `<span class="badge cat" title="${esc(CAT_LABEL[v.category])}">${v.category === "U" ? "Unique hull" : v.category}</span>`}${API ? `<button class="badge badgebtn" data-faction="${i}" title="Reclassify: move ${esc(v.name)} to another faction${v.faction_card && v.faction_card !== v.faction ? ` (was ${esc(v.faction_card)})` : ""}">${esc(v.faction)}</button>` : `<span class="badge">${esc(v.faction)}</span>`}${uniqueBadge(v, i)}${PUBLIC ? "" : `<span class="badge">${badge}</span>`}${API && !v.dropped ? `<button class="badge badgebtn pubbadge ${isPub(v) ? "pub-on" : "pub-off"}" data-pub="${i}" title="${isPub(v) ? "On the website. Click to change what shows, or unpublish" : "Not on the website. Click to publish (opt-in)"}">${isPub(v) ? "Published" : "Private"}</button>` : ""}${v.gm_only ? `<span class="badge gm">GM only</span>` : ""}${review}</div>
      ${(v.tags || []).length || API ? `<div class="tagrow">${(v.tags || []).map((t) => `<span class="otag">${esc(t)}${API ? `<button class="rmbtn" data-rmtag="${i}" data-tag="${esc(t)}" aria-label="Remove the tag ${esc(t)}" title="Remove this tag">✕</button>` : ""}</span>`).join("")}${API ? `<button class="linkbtn tagadd" data-addtag="${i}" title="Tag this ship with one of your factions">＋ tag</button>` : ""}</div>` : ""}
      <h2>${esc(v.name)}${API ? `<button class="rnbtn" data-rename="${i}" aria-label="Rename ${esc(v.name)}" title="Rename this ship">✎</button>` : ""}</h2>${v.name_card && v.name_card !== v.name && !(v.detached && v.source !== "book") ? `<div class="namewas" title="Your rename">${v.source === "book" ? "In the book" : "On the card"}: ${esc(v.name_card)}</div>` : ""}
      ${v.hull_label ? `<div class="hullline" title="Your label (the hull row keeps its own name)">${esc(v.hull_label)}</div>` : v.hull ? `<div class="hullline">${esc(v.hull)}${v.hull_custom ? " · custom hull" : ""}${v.hull_class_name && !String(v.hull).toLowerCase().includes(v.hull_class_name.toLowerCase().replace(/-class$/, "")) ? ` · ${esc(v.hull_class_name)}` : ""}</div>` : (v.hull_class_name ? `<div class="hullline">${esc(v.hull_class_name)}</div>` : "")}
      ${v.captain || API ? `<div class="captainline"><span class="label">Captain</span> ${v.captain ? esc(v.captain) : `<span class="note">none named</span>`}${API ? ` <button class="linkbtn" data-captain="${i}" aria-label="Set the captain of ${esc(v.name)}" title="Name this ship's captain">✎</button>` : ""}</div>` : ""}
      ${v.description ? `<div class="vdesc" tabindex="0" title="Click to expand">${esc(v.description)}</div>` : ""}${API ? `<button class="linkbtn descedit" data-desc="${i}" title="Write this ship's description">${v.description ? "✎ description" : "＋ description"}</button>` : ""}
      ${!(v.unique && v.unique.unique) && ((v.names || []).length || API) ? `<div class="shipnames">${(v.names || []).length ? `<span class="label">Ships of this kind</span> ${v.names.map(esc).join(" · ")}` : `<span class="note">No ship names listed</span>`}${API ? ` <button class="linkbtn" data-names="${i}" title="Names of the ships of this subtype">✎ names</button>` : ""}</div>` : ""}
      <div class="stats">${statHTML}</div>
      <div class="meters">${meter("Space", v.space_used, v.space_total, spaceRem(v), "space", hw ? `class-dev="${hw}" tabindex="0" role="button" data-v="${i}" data-sel='{"hull":true}'` : "")}${meter("Power", v.power_used, v.power_total, v.power_remaining, "power")}${v.power_idle ? `<div class="note idle">${esc(v.power_idle)} Power not drawn (unpowered, disabled or destroyed components)</div>` : ""}${(v.power_adjustments || []).length ? `<div class="note idle" title="${esc(v.power_adjustments.map((a) => a.text).join(" "))}">Power available includes ${esc(v.power_adjustments.map((a) => `${a.delta > 0 ? "+" : ""}${a.delta} (${a.source})`).join(", "))}</div>` : ""}</div>
      <div class="slots">${slots}</div>${API ? pickRowsHTML(v, i) : ""}
      ${sw ? `<div class="loadout dev dev-${sw}" tabindex="0" role="button" data-v="${i}" data-sel='{"specified":true}'>Unique vessel: loadout not fully specified</div>` : ""}
      ${!v.unique?.unique && v.choice_printed ? `<div class="note varies" title="${esc(v.choice_printed)}">Subtype loadout varies: “${esc(v.choice_printed)}”</div>` : ""}
      ${lw ? `<div class="loadout dev dev-${lw}" tabindex="0" role="button" data-v="${i}" data-sel='{"loadout":true}'>Loadout differs from ${esc(v.based_on_name || "the book ship")}</div>` : ""}
      ${(() => { const key = v.vessel_id || v.id, open = cardOpen(v); return `<button class="cardtoggle" data-cardtoggle="${esc(key)}" aria-expanded="${open}" title="Show or hide this ship's components and everything below">${open ? "▾ Hide components" : "▸ Show components"}</button><div class="cardbody"${open ? "" : " hidden"}>`; })()}
      <div class="comps main${API ? " stcols" : ""}"><div class="comphead"><span>Component</span><span class="crhead" title="Component Craftsmanship (Battlefleet Koronus): Poor, Common, Good, Best">Craft.</span><span>Power</span><span>Space</span>${API ? `<span class="sthead">Status</span>` : ""}</div>${hullRowHTML(v, i)}${comps || `<div class="empty">No components listed</div>`}</div>
      ${API ? `<div class="loadbar"><button class="act addbtn" data-pick="${i}" title="Add a component, special rule, upgrade, background package or complication">＋ Add to the loadout…</button>${(v.removed_items || []).length ? `<span class="note">${v.removed_items.length} removed from the book's loadout</span>` : ""}</div>` : ""}
      <div class="more">${magazineHTML(v, i)}
      ${extras ? `<div class="comps"><div class="loc">Upgrades, background packages and complications</div>${extras}</div>` : ""}
      ${climW ? `<div class="loadout dev dev-${climW}" tabindex="0" role="button" data-v="${i}" data-sel='{"climit":true}'>${esc(devsFor(v, { climit: true }).map((d) => d.label).join("; "))}: more than one listed</div>` : ""}
      ${histHidden.length ? `<p class="note hiddenhist" title="${esc(histHidden.map((e) => `${EXTRA_LABEL[e.kind] || e.kind}: ${e.name}`).join("; "))}">A vessel subtype: ${histHidden.length} background package/complication entr${histHidden.length === 1 ? "y is" : "ies are"} not shown, but still count in its stats (${esc(histHidden.map((e) => e.name).join(", "))}).</p>` : ""}
      ${special ? `<details${kwOpen.has(v.vessel_id) ? " open" : ""} data-kwv="${esc(v.vessel_id || "")}"><summary>Special rules and abilities${(v.special || []).length ? ` (${v.special.length})` : ""}</summary>${special}</details>` : ""}
      ${modHTML}</div>
      <div class="foot"><span>${src}</span>${v.source === "copy" && v.based_on ? `<button class="linkbtn" data-compare="${i}">Compare with the book</button>` : ""}${v.source === "book" && (v.merged_copies || []).length ? `<span title="${esc(v.merged_copies.map((m) => m.name).join(", "))}">your copy merged in</span>` : ""}${v.source === "book" && API ? `<button class="linkbtn" data-fork="${esc(v.id)}">Make a custom variant</button><button class="linkbtn" data-decouple="${i}" title="Make an independent ship from this book ship, with its current values">De-couple…</button>` : ""}${v.source !== "book" && API && (v.based_on || (v.has_card && !v.detached)) ? `<button class="linkbtn" data-decouple="${i}" title="Stop following the book ship and/or the spreadsheet card">De-couple…</button>` : ""}${v.detached ? `<span title="De-coupled from its spreadsheet card: re-imports leave it alone">no card link</span>` : ""}${API && !v.dropped ? `<button class="linkbtn dangerlink" data-drop="drop" data-v="${i}" title="Remove this ship from the roster (its book entry or spreadsheet card stays)">Drop from the roster…</button>` : ""}${v.decoupled_from_book ? `<span title="De-coupled from its book ship">no book link</span>` : ""}${v.source === "book" && API && v.adjustments ? `<button class="linkbtn" data-reset="reset" data-v="${i}" title="Remove your ${v.adjustments} adjustment(s) to this book ship (a snapshot is kept, so it can be undone)">Reset to the book (${v.adjustments})</button>` : ""}${v.source === "book" && API && v.resets ? `<button class="linkbtn" data-reset="undo_reset" data-v="${i}" title="Restore the adjustments removed by the last reset">Undo reset</button>` : ""}${v.components_without_values ? `<span title="Components with no Power/Space value found">${v.components_without_values} without values</span>` : ""}</div></div>
    </article>`;
  }

  const STATUS_SHORT = { intact: "OK", damaged: "DMG", destroyed: "DEST", unpowered: "UNPW", depressurised: "VAC", on_fire: "FIRE", disabled: "OFF" };
  const STATUS_OPTS = [["intact", "Intact"], ["damaged", "Damaged"], ["destroyed", "Destroyed"], ["unpowered", "Unpowered"],
    ["depressurised", "Depressurised"], ["on_fire", "On fire"], ["disabled", "Disabled"]];
  const STATUS_NAME = { damaged: "Damaged", destroyed: "Destroyed", unpowered: "Unpowered", depressurised: "Depressurised", on_fire: "On fire", disabled: "Disabled" };
  const STATUS_HELP = { damaged: "Damaged: its bonuses don't apply until repaired.", destroyed: "Destroyed: gone until rebuilt; draws no power.",
    unpowered: "Unpowered: draws no power and does nothing.", depressurised: "Depressurised: no crew can work it.",
    on_fire: "On fire: burning (Fire! critical).", disabled: "Disabled: switched off or out of action; draws no power." };
  function builderHTML(v, c) {
    if (!API || v.source === "book" || !c || !c.uid || c.kind === "hull") return "";
    const q = c.quality || "common", rules = c.quality_rules;
    const lv = ["poor", "common", "good", "best"].map((x) => `<label class="qlv"><input type="radio" name="qlv" value="${x}"${x === q ? " checked" : ""}${rules || x === "common" ? "" : " disabled"}> ${x === "common" ? "Common" : QUALITY[x]}</label>`).join("");
    const st = Object.keys(STATUS_NAME).map((s) => `<label class="qlv" title="${esc(STATUS_HELP[s])}"><input type="checkbox" name="cst" value="${s}"${(c.statuses || []).includes(s) ? " checked" : ""}> ${STATUS_NAME[s]}</label>`).join("");
    return `<div class="builder"><div class="sub">Craftsmanship</div>
      ${rules ? `<div class="qlvs">${lv}</div><div id="qopts"></div><button class="act" id="q-apply">Apply craftsmanship</button>` : `<p class="note">No record values to apply craftsmanship to (a card-only custom component).</p>`}
      <div class="sub">Status</div><div class="qlvs">${st}</div><p class="note">None ticked = Intact. Damaged, destroyed, unpowered and disabled components don't give their bonuses (the Munitorium's +1, for example); destroyed, unpowered and disabled ones draw no power.</p>
      <button class="act" id="st-apply">Save status</button><p class="err" id="b-err" hidden></p></div>`;
  }
  function renderLinkList() {
    const box = $("#lp-list"); if (!box) return;
    const q = ($("#lp-q").value || "").trim().toLowerCase(), words = q.split(/\s+/).filter((w) => w.length > 2);
    if (!q && !(ctx.suggest || []).length) { box.innerHTML = `<p class="note">Type a name or a word (e.g. "shield", "Jovian").</p>`; return; }
    const all = Object.entries(R.components).filter(([k]) => !k.startsWith("custom:"));
    const score = ([k, r]) => (ctx.suggest || []).includes(k) ? 100 : words.filter((w) => (r.name || "").toLowerCase().includes(w)).length * 10 - Math.abs((r.name || "").length - q.length) / 20;
    const hits = all.map((x) => [x, score(x)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const vals = (r) => { const p = (r.profiles || [])[0] || {}; return [p.power_generated != null ? `+${p.power_generated} gen` : p.power != null ? `P ${p.power}` : null, p.space != null ? `S ${p.space}` : null].filter(Boolean).join(" · "); };
    box.innerHTML = hits.map(([[k, r]]) => `<div class="lprow"><span><b>${esc(r.name)}</b>${r.ci ? CI_TAG : ""} <span class="why">${esc(r.ci ? r.where : `${r.book}${r.page ? " p" + r.page : ""}`)}${vals(r) ? " · " + esc(vals(r)) : ""}${(ctx.suggest || []).includes(k) ? " · suggested" : ""}</span></span>
      <span><button class="mini" data-relink="use_stats_of" data-ref="${esc(k)}" title="Keep the name on your card; use this component's stats exactly">Use its stats</button><button class="mini" data-relink="replace_with" data-ref="${esc(k)}" title="Change the name and the stats to this component">Replace with it</button></span></div>`).join("")
      || `<p class="note">No component matches; try fewer words.</p>`;
  }
  document.addEventListener("input", (e) => { if (e.target.id === "lp-q") renderLinkList(); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#lp-build")) return;
    const { v, c } = ctx, w = c.weapon || c.printed_weapon || {};
    const weaponish = ["prow", "dorsal", "port", "starboard", "keel", "unslotted"].includes(c.location) || c.kind === "weapon";
    const group = c.location === "essential" || c.kind === "essential" ? "essential" : weaponish ? "weapon" : "supplemental";
    const ess = [["drive", "Plasma drive"], ["warp", "Warp engine"], ["g[ae]ll?[ae]r", "Gellar field"], ["shield|vs\\b", "Void shields"], ["bridge", "Bridge"], ["sustainer", "Life sustainer"], ["quarters|barracks", "Crew quarters"], ["aug[eu]r|sensor|auspex", "Augur array"]];
    const wpn = [["lance", "Lance"], ["torpedo|launcha", "Torpedo tubes"], ["bay", "Landing bay"], ["nova", "Nova cannon"], ["macro|cannon|batter|gun|kannon", "Macrobattery"]];
    const guess = (list) => (list.find(([rx]) => new RegExp(rx, "i").test(c.name)) || [null, ""])[1];
    const cls = { T: "T", R: "R", F: "F", LC: "LC", C: "C", BC: "BC", GC: "GC" }[v.category];
    wsDraft = Object.assign(blankDraft(), { name: c.name, group, subtype: group === "essential" ? guess(ess) : group === "weapon" ? guess(wpn) || "Other weapon" : "",
      origin: v.faction || "", profiles: [{ classes: cls ? [cls] : ["all"], power: c.power_generated ?? c.power ?? "", generates: c.power_generated != null, space: c.space ?? "", sp: "" }],
      weapon: { strength: w.strength ?? "", damage: w.damage ?? "", crit: w.crit ?? "", range: w.range ?? "" },
      link: { vessel_id: v.source === "book" ? v.id : v.vessel_id, uid: c.uid || null, index: c.index, vessel_name: v.name } });
    dlg.close(); setTab("ws");
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-reset]"); if (!b) return;
    const v = shown[+b.dataset.v]; if (!v) return;
    if (b.dataset.reset === "reset" && !confirm(`Reset ${v.name} to the book? Your ${v.adjustments} adjustment(s) are removed; "Undo reset" brings them back.`)) return;
    try { const j = await post("/api/decide-book", { vessel_id: v.id, key: "reset", action: b.dataset.reset }); R = j.data; render(); }
    catch (x) { alertBox(x.message); }
  });
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#lp-rename")) return;
    const { v, c } = ctx, err = $("#lp-err"), name = ($("#lp-name").value || "").trim();
    try {
      const j = v.source === "book"
        ? await post("/api/decide-book", { vessel_id: v.id, key: `name:c${c.index}`, action: "rename_stub", data: { name } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { component: c.uid }, action: "rename_stub", field: name });
      R = j.data; render(); dlg.close();
    } catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } }
  });
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-relink]"); if (!b) return;
    const { v, c } = ctx, err = $("#lp-err");
    try {
      const j = v.source === "book"
        ? await post("/api/decide-book", { vessel_id: v.id, key: b.dataset.relink === "restore" && c.split_key ? c.split_key : `link:c${c.index}`, action: b.dataset.relink, ref: b.dataset.ref || null })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { component: c.uid }, action: b.dataset.relink, ref: b.dataset.ref || null });
      R = j.data; render(); dlg.close();
    } catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } }
  });
  function renderQualityOptions() {
    const { c } = ctx; const box = $("#qopts"); if (!box || !c || !c.quality_rules) return;
    const q = (document.querySelector('input[name="qlv"]:checked') || {}).value || "common";
    if (q === "common") { box.innerHTML = `<p class="note">Common: no modifiers. Any earlier bonus is removed.</p>`; return; }
    const r = c.quality_rules[q], keep = q === (c.quality || "common") ? [].concat(c.quality_choice || []) : [];
    const fmtv = (p) => `${esc(p.label)} ${esc(fmt(p.from))} → ${esc(fmt(p.to))}`;
    if (!r.choose) { box.innerHTML = `<p class="note">${esc(QUALITY[q])} (${esc(r.table)}) applies both: ${r.preview.map(fmtv).join("; ")}.</p>`; return; }
    const viable = r.preview.filter((p) => p.viable).length, need = Math.min(r.choose, viable);
    box.innerHTML = `<p class="note">${esc(QUALITY[q])} (${esc(r.table)}): choose ${need} bonus${need === 1 ? "" : "es"}.${c.is_weapon ? " This component has a Strength, so it uses the weapon table." : ""}${q !== (c.quality || "common") && (c.quality_choice || []).length ? " The bonus chosen for the old level is removed." : ""}</p>`
      + r.preview.map((p) => `<label class="qopt${p.viable ? "" : " off"}"><input type="checkbox" name="qopt" value="${p.key}"${keep.includes(p.key) ? " checked" : ""}${p.viable ? "" : " disabled"}> ${fmtv(p)}${p.viable ? "" : " (changes nothing here)"}</label>`).join("")
      + `<p class="note" id="qcount" data-need="${need}"></p>`;
    const upd = () => { const n = document.querySelectorAll('input[name="qopt"]:checked').length; $("#qcount").textContent = `${n} of ${need} chosen`; };
    upd();
  }
  const CI_TAG = R && R.public ? "" : `<span class="tag-ci" title="Your own entry, from your Content Index (custom)">CI</span>`;
  const isWeaponLoc = (c) => ["prow", "dorsal", "port", "starboard", "keel", "aft"].includes(c.location);
  function weaponLine(v, c) {
    const w = (v.source === "book" ? c.printed_weapon || c.weapon : c.weapon) || null;
    const parts = [];
    if (w && (w.strength != null || w.damage)) {
      parts.push(`Str ${fmt(w.strength)}`, `Dmg ${fmt(w.damage)}`, `Crit ${fmt(w.crit)}`, `Range ${fmt(w.range)}`);
    }
    const tube = c.tube;
    if (tube) parts.push(`${tube.salvo ? `Salvo ${tube.salvo} · ` : ""}Stores ${fmt(tube.stored)}${tube.in_tubes ? ` + ${tube.in_tubes} in the tubes` : ""}`);
    if (!parts.length) return isWeaponLoc(c) && c.kind !== "hull" ? `<span class="wp none">No attack profile recorded</span>` : "";
    const marked = (c.weapon_mods || []).length || (c.weapon_mods_inactive || []).length;
    return `<span class="wp${marked ? " modded" : ""}">${parts.map(esc).join(" · ")}</span>`;
  }
  function magazineHTML(v, i) {
    const m = v.magazine; if (!m) return "";
    const edit = API && v.source !== "book";
    const cap = m.capacity != null ? `${m.loaded}${m.unknown_counts ? "+?" : ""} / ${m.capacity}` : `${m.loaded}${m.unknown_counts ? "+?" : ""} aboard`;
    const capNote = m.capacity_source === "card" && m.tube_capacity && m.tube_capacity !== m.capacity ? ` (your card; the tubes hold ${m.tube_capacity})` : m.capacity_source === "tubes" ? " (from the tubes' storage)" : "";
    const rows = m.entries.map((e) => {
      const prof = [e.speed != null ? `Speed ${e.speed}` : null, `Dmg ${fmt(e.damage)}`, `Crit ${fmt(e.crit)}`, `Range ${fmt(e.range)}`, `Torpedo Rating ${fmt(e.torpedo_rating)}`].filter(Boolean).join(" · ");
      const cnt = edit
        ? `<span class="p var"><button class="step" data-ord="-1" data-v="${i}" data-o="${esc(e.uid)}" aria-label="Fire one" ${!e.count ? "disabled" : ""}>−</button><input class="cnt" type="number" min="0" max="9999" value="${e.count == null ? "" : e.count}" placeholder="?" data-v="${i}" data-o="${esc(e.uid)}" aria-label="Torpedoes of this type aboard"><button class="step" data-ord="1" data-v="${i}" data-o="${esc(e.uid)}" aria-label="Load one">+</button></span>`
        : `<span class="p">${esc(e.count == null ? "?" : e.count)}</span>`;
      const fix = edit && e.unresolved ? `<select class="ordfix" data-v="${i}" data-o="${esc(e.uid)}" aria-label="Which torpedo type is this?"><option value="">Which torpedo is this?</option>${R.ordnance.warheads.map((x) => `<option value="${esc(x.ref)}">${esc(x.name)}${x.custom ? " (CI)" : ""}</option>`).join("")}</select>` : "";
      return `<div class="comp torp${e.unresolved ? " unres" : ""}" tabindex="0" data-v="${i}" data-t="${esc(e.uid)}"><span class="nm${e.unresolved ? " unresolved" : ""}">${esc(e.name)}${e.custom ? CI_TAG : ""}${e.name_printed && e.name_printed !== e.name ? `<span class="printed"> — card: ${esc(e.name_printed)}</span>` : ""}</span>${cnt}<span class="s">${edit ? `<button class="linkbtn" data-ordrm="${esc(e.uid)}" data-v="${i}" aria-label="Remove ${esc(e.name)}">✕</button>` : ""}</span><span class="wp">${e.unresolved ? "Not matched to a torpedo type." : esc(prof)}${e.damage_book ? ` <span class="ruled" title="Book ${esc(e.damage_book)}; house rule −12 (Q11)">house rule</span>` : ""}</span>${fix}</div>`;
    }).join("");
    const add = edit ? `<form class="addtorp" data-v="${i}"><select name="warhead" aria-label="Torpedo type" required><option value="">Torpedo type…</option>${R.ordnance.warheads.map((x) => `<option value="${esc(x.ref)}">${esc(x.name)}${x.custom ? " (CI)" : ""}</option>`).join("")}</select><select name="guidance" aria-label="Guidance"><option value="">Standard guidance</option>${R.ordnance.guidance.filter((x) => !/standard/i.test(x.name)).map((x) => `<option value="${esc(x.ref)}">${esc(x.name)}${x.custom ? " (CI)" : ""}</option>`).join("")}</select><input name="count" type="number" min="0" max="9999" value="6" aria-label="How many"><button class="act" type="submit">Add</button></form>` : "";
    return `<div class="comps mag"><div class="loc">Torpedoes aboard · ${esc(cap)}${esc(capNote)}${m.salvo ? ` · salvo ${m.salvo}` : ""}</div>${rows || `<div class="empty">None recorded.</div>`}${add}</div>`;
  }

  function hullEditHTML(v) {
    const h = v.hull_row || {}, book = v.source === "book";
    return `<div class="builder hulledit"><div class="sub">This hull</div>
      <p class="note">${esc(h.name_override || h.name || v.hull || "Hull")}${h.stub ? " · a stub (no record)" : h.custom ? " · from your custom hull register" : h.ref ? ` · ${esc(h.source || "catalogue record")}` : " · no record"}${book ? ". On a book ship these are your rulings; the book stays as printed." : ""}</p>
      <div class="renrow"><input type="text" id="hl-name" value="${esc(h.name_override || h.name || v.hull || "")}" maxlength="120" aria-label="Hull name"><button class="act" id="hl-rename">Rename</button></div>
      <p class="note">Renaming changes the hull row only. The label under the vessel's name is set here (leave it empty to show the derived label: “${esc(derivedHullLabel(v))}”).</p>
      <div class="renrow"><input type="text" id="hl-label" value="${esc(v.hull_label || "")}" placeholder="${esc(derivedHullLabel(v))}" maxlength="160" aria-label="Label under the vessel's name"><button class="act" id="hl-label-save">Save label</button></div>
      <div class="acts"><button class="act" id="hl-custom" title="Adds it to your custom hull register (name, Space ${esc(fmt(v.space_total))}, class ${esc(v.category)}) and uses it">Make it a custom hull</button>
        <button class="act" id="hl-stub" title="No hull record: it only fills the hull line">Mark as a stub</button>
        ${book && (h.action || h.name_override) ? `<button class="act" id="hl-restore">Restore the book's hull</button>` : ""}</div>
      <div class="sub">Replace with a hull from the catalogue</div>
      <input type="search" id="hl-q" placeholder="Search hulls…" aria-label="Search hulls"><div id="hl-list" class="lplist"></div>
      <p class="err" id="hl-err" hidden></p></div>`;
  }
  function renderHullList() {
    const box = $("#hl-list"); if (!box) return;
    const q = ($("#hl-q").value || "").trim().toLowerCase();
    if (!q) { box.innerHTML = `<p class="note">Type a hull name or class (e.g. "Lunar", "raider").</p>`; return; }
    const all = Object.entries(R.hulls || {}).map(([k, h]) => [k, h.name, `${h.book}${h.page ? " p" + h.page : ""}`, h.space])
      .concat(Object.entries(R.custom_hulls || {}).map(([k, h]) => [k, h.name, "your custom hull register", h.space]));
    const hits = all.filter(([, n]) => (n || "").toLowerCase().includes(q)).slice(0, 12);
    box.innerHTML = hits.map(([k, n, src, sp]) => `<div class="lprow"><span><b>${esc(n)}</b> <span class="why">${esc(src)}${sp != null ? " · Space " + esc(sp) : ""}</span></span><span><button class="mini" data-hullrep="${esc(k)}" data-hullname="${esc(n)}">Replace with it</button></span></div>`).join("")
      || `<p class="note">No hull matches.</p>`;
  }
  const derivedHullLabel = (v) => [v.hull, v.hull_custom ? "custom hull" : null,
    v.hull_class_name && !String(v.hull || "").toLowerCase().includes(v.hull_class_name.toLowerCase().replace(/-class$/, "")) ? v.hull_class_name : null].filter(Boolean).join(" · ");
  async function hullLabel(label) {
    const { v } = ctx, err = $("#hl-err");
    try {
      const j = v.source === "book"
        ? await post("/api/decide-book", { vessel_id: v.id, key: "hull_label", action: "hull_label", data: { label } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { hull: true }, action: "hull_label", field: label });
      R = j.data; render(); dlg.close();
    } catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } }
  }
  async function hullAct(action, ref, name) {
    const { v } = ctx, err = $("#hl-err");
    try {
      const j = v.source === "book"
        ? await post("/api/decide-book", { vessel_id: v.id, key: "hull", action, ref: ref || null, data: { name } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { hull: true }, action, ref: ref || null, field: name || null });
      R = j.data; render(); dlg.close();
    } catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } }
  }
  document.addEventListener("input", (e) => { if (e.target.id === "hl-q") renderHullList(); });
  document.addEventListener("click", (e) => {
    if (!ctx || !e.target.closest(".hulledit")) return;
    const name = ($("#hl-name") || {}).value || "";
    if (e.target.closest("#hl-rename")) return hullAct("hull_rename", null, name.trim());
    if (e.target.closest("#hl-label-save")) return hullLabel((($("#hl-label") || {}).value || "").trim());
    if (e.target.closest("#hl-custom")) return hullAct("hull_custom", null, name.trim());
    if (e.target.closest("#hl-stub")) { if (confirm(`Mark the hull of ${ctx.v.name} as a stub? It keeps its name and Space but has no record (no hull stats or rules).`)) hullAct("hull_stub"); return; }
    if (e.target.closest("#hl-restore")) return hullAct("restore");
    const rep = e.target.closest("[data-hullrep]");
    if (rep && confirm(`Are you sure? Replace the hull of ${ctx.v.name} (${(ctx.v.hull_row || {}).name || ctx.v.hull || "no hull"}) with ${rep.dataset.hullname}?\n\nIts Space total, hull stats, weapon capacity and built-in components change to the new hull's.`)) hullAct("hull_replace", rep.dataset.hullref || rep.dataset.hullrep);
  });
  const kwRows = () => (R.component_table || []).filter((r) => r.group === "keyword");
  const kwOpen = new Set();
  function kwLabel(r) { return `${r.name} — ${(r.mechanics || r.fluff || "").replace(/\s+/g, " ").slice(0, 70)}${r.found && r.found !== "—" ? ` [${r.found.replace(/^\d+: /, "").slice(0, 40)}]` : ""}`; }
  function kwDatalist() {
    let dl = document.getElementById("kwlist");
    if (!dl) { dl = document.createElement("datalist"); dl.id = "kwlist"; document.body.appendChild(dl); }
    dl.innerHTML = kwRows().map((r) => `<option value="${esc(kwLabel(r))}">`).join("");
  }
  function openKeyword(ref) {
    const r = ref ? kwRows().find((x) => x.ref === ref) : { ref: null, name: "", fluff: "", mechanics: "", text_original: null, found_all: [] };
    if (!r) return;
    ctx = { kw: r };
    $("#review-title").textContent = r.ref ? `Special rule: ${r.name}` : "New special rule";
    $("#review-body").innerHTML = `${r.ref ? `<p class="meta">${esc(r.kind)} · ${esc(r.source || "")}</p>` : `<div class="renrow"><input type="text" id="kw-name" maxlength="80" placeholder="Name (e.g. Defensive)" aria-label="Name"></div>`}
      ${r.text_original ? `<div class="sub">As printed</div><p class="note">${esc(r.text_original)}</p>` : ""}
      ${(r.found_all || []).length ? `<div class="sub">Found on (${r.found_all.length})</div><p class="note">${esc(r.found_all.join(", "))}</p>` : ""}
      ${r.variants > 1 ? `<p class="note">${r.variants} rules share this name with different text; each is its own entry.</p>` : ""}
      <div class="sub">Fluff (descriptive text; not read for effects)</div><textarea id="kw-fluff" rows="2">${esc(r.fluff || "")}</textarea>
      <div class="sub">Mechanics (what the roster reads${r.text_original ? "; replaces the printed text wherever this rule appears" : ""})</div><textarea id="kw-mech" rows="4">${esc(r.mechanics || "")}</textarea>
      <div id="ws-parse" class="parsecheck"></div><textarea id="ws-text" hidden>${esc(r.mechanics || "")}</textarea>
      <div class="acts"><button class="act" data-kwsave="reviewed">Save and mark reviewed</button>${r.ref && !String(r.ref).startsWith("custom-kw:") ? `<button class="act" data-kwsave="pending">Save, still needs review</button><button class="act" data-kwsave="revert" title="Back to the printed text and 'needs review'">Revert to printed</button>` : ""}${r.ref && String(r.ref).startsWith("custom-kw:") ? `<button class="act" data-kwsave="delete">Delete</button>` : ""}</div>
      <p class="err" id="kw-err" hidden></p>`;
    runParse();
    tip.hidden = true;
    dlg.showModal();
  }
  document.addEventListener("input", (e) => { if (e.target.id === "kw-mech") { const t = $("#ws-text"); if (t) { t.value = e.target.value; runParse(); } } });
  document.addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-kwedit]"); if (ed) return openKeyword(ed.dataset.kwedit);
    if (e.target.closest("[data-kwnew]")) return openKeyword(null);
    const sv = e.target.closest("[data-kwsave]");
    if (sv && ctx && ctx.kw) {
      const r = ctx.kw, mode = sv.dataset.kwsave, err = $("#kw-err");
      if (mode === "delete" && !confirm(`Delete ${r.name}? Vessels that carry it keep its name but lose its effects.`)) return;
      const kw = { id: r.ref, name: r.ref ? r.name : ($("#kw-name").value || "").trim(), text_original: r.text_original, fluff: $("#kw-fluff").value, mechanics: $("#kw-mech").value,
        status: mode === "pending" ? "pending" : "reviewed", revert: mode === "revert", delete: mode === "delete" };
      try { const j = await post("/api/keyword", { keyword: kw }); R = j.data; dlg.close(); state.tab === "cat" ? renderCatalogue() : render(); kwDatalist(); }
      catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } }
      return;
    }
    const add = e.target.closest("[data-kwadd]"), rm = e.target.closest("[data-kwrm]");
    if (!add && !rm) return;
    const v = shown[+(add ? add.dataset.kwadd : rm.dataset.v)]; if (!v) return;
    let list = (v.special || []).filter((x) => x.keyword).map((x) => { const r = kwRows().find((k) => k.ref === x.keyword); return { id: x.keyword, name: x.name, text: r ? (r.text_original || r.mechanics) : x.text }; });
    if (add) {
      const inp = document.querySelector(`.kwadd[data-v="${add.dataset.kwadd}"]`), val = (inp.value || "").trim();
      const r = kwRows().find((k) => kwLabel(k) === val) || kwRows().find((k) => k.name.toLowerCase() === val.toLowerCase());
      if (!r) return alertBox(`No special rule called "${val}". Pick one from the list, or make it in the catalogue (Special rules → New special rule).`);
      list.push({ id: r.ref, name: r.name, text: r.text_original || r.mechanics });
    } else list.splice(+rm.dataset.kwrm, 1);
    kwOpen.add(v.vessel_id);
    try { const j = await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action: "set_keywords", data: { keywords: list } }); R = j.data; render(); }
    catch (x) { alertBox(x.message); }
  });
  // ---- loadout editor: add components, special rules, upgrades, background packages, complications; remove with confirmation
  const pdlg = $("#picker"), cdlg = $("#confirm");
  function confirmBox(title, msg, ok) {                       // a modal confirmation; resolves true only on the explicit button
    return new Promise((resolve) => {
      $("#cf-title").textContent = title; $("#cf-msg").textContent = msg; $("#cf-ok").textContent = ok || "Remove";
      const done = (v) => { cdlg.close(); $("#cf-ok").onclick = $("#cf-cancel").onclick = null; resolve(v); };
      $("#cf-ok").onclick = () => done(true); $("#cf-cancel").onclick = () => done(false);
      cdlg.onclose = () => resolve(false);
      cdlg.showModal(); $("#cf-cancel").focus();               // the safe choice has focus
    });
  }
  function promptBox(title, msg, value, ok) {                 // a modal with one text field; resolves the text, or null
    return new Promise((resolve) => {
      $("#cf-title").textContent = title;
      $("#cf-msg").innerHTML = `${esc(msg)}<input type="text" id="cf-input" maxlength="120" value="${esc(value || "")}" aria-label="${esc(title)}">`;
      $("#cf-ok").textContent = ok || "Save"; $("#cf-ok").classList.remove("danger");
      const inp = $("#cf-input");
      const done = (v) => { cdlg.close(); $("#cf-ok").classList.add("danger"); $("#cf-ok").onclick = $("#cf-cancel").onclick = inp.onkeydown = null; resolve(v); };
      $("#cf-ok").onclick = () => done(inp.value.trim()); $("#cf-cancel").onclick = () => done(null);
      inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); done(inp.value.trim()); } };
      cdlg.onclose = () => resolve(null);
      cdlg.showModal(); inp.focus(); inp.select();
    });
  }
  function decoupleBox(v) {                                   // choose what to cut loose from; resolves the list, or null
    return new Promise((resolve) => {
      const opts = [];
      if (v.based_on) opts.push(["book", `From the book ship (${v.based_on_name || "its book entry"})`, "No longer a copy: it stops being compared with the book ship, and the values it shows now become its own."]);
      if (v.has_card && !v.detached) opts.push(["card", `From its spreadsheet card (${v.sheet || "VOIDSHIPS.xlsx"})`, "Its current loadout and stats become its new baseline (the card's numbers stop counting), and re-imports from the spreadsheet leave it alone."]);
      $("#cf-title").textContent = `De-couple ${v.name}?`;
      $("#cf-msg").innerHTML = `This can't be undone from the roster.${opts.map(([k, l, h]) => `<label class="qlv cf-opt"><input type="checkbox" name="cf-dc" value="${k}" checked> <b>${esc(l)}</b><span class="note">${esc(h)}</span></label>`).join("")}`;
      $("#cf-ok").textContent = "De-couple";
      const done = (val) => { cdlg.close(); $("#cf-ok").onclick = $("#cf-cancel").onclick = null; resolve(val); };
      $("#cf-ok").onclick = () => { const sel = [...document.querySelectorAll('input[name="cf-dc"]:checked')].map((x) => x.value); done(sel.length ? sel : null); };
      $("#cf-cancel").onclick = () => done(null);
      cdlg.onclose = () => resolve(null);
      cdlg.showModal(); $("#cf-cancel").focus();
    });
  }
  async function decoupleVessel(v) {
    try {
      if (v.source === "book") {
        if (!(await confirmBox(`De-couple ${v.name} from the book?`, `The book's ${v.name} stays as printed. This makes a new, independent ship with ${v.name}'s current loadout and values (your adjustments included) that never follows the book again. You can rename and edit it freely.`, "Make the independent ship"))) return;
        const j = await post("/api/fork", { vessel_id: v.id, independent: true, name: `${v.name} (independent)` }); R = j.data; state.focus = { id: j.created, name: `${v.name} (independent)` }; render(); window.scrollTo(0, 0);
        return;
      }
      const from = await decoupleBox(v); if (!from) return;
      const j = await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action: "decouple", data: { from } }); R = j.data; render();
    } catch (x) { alertBox(x.message); }
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-decouple]"); if (b) { e.stopPropagation(); decoupleVessel(shown[+b.dataset.decouple]); } }, true);
  async function dropVessel(v, action) {
    const book = v.source === "book", id = book ? v.id : v.vessel_id;
    if (action === "drop" && !(await confirmBox(`Drop ${v.name} from the roster?`,
      `${v.name} leaves the roster. ${book ? "The book's entry is untouched" : "Its spreadsheet card is untouched, and re-imports won't bring it back"}; nothing is deleted, so you can restore it with "Show dropped ships".`, "Drop it"))) return;
    try { const j = await post("/api/drop", { vessel_id: id, action }); R = j.data; render(); }
    catch (x) { alertBox(x.message); }
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-drop]"); if (b) { e.stopPropagation(); dropVessel(shown[+b.dataset.v], b.dataset.drop); } }, true);
  function factionBox(v) {                                    // pick a faction bin (or type a new one); resolves the text, or null
    return new Promise((resolve) => {
      const opts = [...new Set((R.factions || []).concat(v.faction_card ? [v.faction_card] : []))].sort();
      $("#cf-title").textContent = `Reclassify ${v.name}`;
      $("#cf-msg").innerHTML = `Now: <b>${esc(v.faction)}</b>${v.faction_card && v.faction_card !== v.faction ? ` (${v.source === "book" ? "the book's" : "the card's"}: ${esc(v.faction_card)})` : ""}.
        <div class="fac-grid">${opts.map((f) => `<label class="qlv"><input type="radio" name="cf-fac" value="${esc(f)}"${f === v.faction ? " checked" : ""}> ${esc(f)}</label>`).join("")}</div>
        <label class="fac-new">Or a new faction <input type="text" id="cf-input" maxlength="40" placeholder="e.g. Chaos Undivided"></label>`;
      $("#cf-ok").textContent = "Reclassify"; $("#cf-ok").classList.remove("danger");
      const done = (val) => { cdlg.close(); $("#cf-ok").classList.add("danger"); $("#cf-ok").onclick = $("#cf-cancel").onclick = null; resolve(val); };
      $("#cf-ok").onclick = () => done(($("#cf-input").value || "").trim() || (document.querySelector('input[name="cf-fac"]:checked') || {}).value || null);
      $("#cf-cancel").onclick = () => done(null);
      cdlg.onclose = () => resolve(null);
      cdlg.showModal(); (document.querySelector('input[name="cf-fac"]:checked') || $("#cf-input")).focus();
    });
  }
  async function reclassify(v) {
    const f = await factionBox(v); if (!f || f === v.faction) return;
    try {
      const j = v.source === "book" ? await post("/api/decide-book", { vessel_id: v.id, key: "faction", action: "set_faction", data: { faction: f } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action: "set_faction", field: f });
      R = j.data; if (state.factions.size && !state.factions.has(f)) state.factions.add(f); render();
    } catch (x) { alertBox(x.message); }
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-faction]"); if (b) { e.stopPropagation(); reclassify(shown[+b.dataset.faction]); } }, true);
  // ---- a new vessel from scratch
  function openNewVessel() {
    if (!API) return alertBox("Run python3 tools/voidship_roster/serve.py to make vessels.");
    const hulls = Object.entries(R.hulls || {}).map(([k, h]) => [k, `${h.name} — ${h.book}${h.page ? " p" + h.page : ""}${h.space != null ? " · Space " + h.space : ""}`])
      .concat(Object.entries(R.custom_hulls || {}).map(([k, h]) => [k, `${h.name} — your custom hull${h.space != null ? " · Space " + h.space : ""}`]));
    ctx = { newv: true, hulls };
    $("#review-title").textContent = "New vessel";
    $("#review-body").innerHTML = `<p class="note">Start a ship from scratch. After it's made, the Add dialog opens so you can fit its components, special rules, upgrades and history. Its stats come from its hull and components.</p>
      <div class="nv-form">
        <label>Name <input type="text" id="nv-name" maxlength="120" required placeholder="e.g. Vigilant Dawn"></label>
        <label>Faction <input type="text" id="nv-fac" list="nv-facs" maxlength="40" value="${esc(state.factions.size === 1 ? [...state.factions][0] : "Imperium")}"></label>
        <datalist id="nv-facs">${(R.factions || []).map((f) => `<option value="${esc(f)}">`).join("")}</datalist>
        <label>Hull (optional) <input type="search" id="nv-hull" list="nv-hulls" placeholder="Search hulls… (e.g. Lunar)"></label>
        <datalist id="nv-hulls">${hulls.map(([, l]) => `<option value="${esc(l)}">`).join("")}</datalist>
        <label>Class <select id="nv-cat"><option value="">From the hull</option>${["T", "R", "F", "LC", "C", "BC", "GC", "U"].map((c) => `<option value="${c}">${esc(CAT_LABEL[c] || c)}</option>`).join("")}</select></label>
      </div>
      <div class="acts"><button class="act primary" id="nv-create">Create the vessel</button></div><p class="err" id="nv-err" hidden></p>`;
    tip.hidden = true; dlg.showModal(); $("#nv-name").focus();
  }
  async function createVessel() {
    const err = $("#nv-err"), name = $("#nv-name").value.trim(), hl = $("#nv-hull").value.trim();
    const hull = hl ? (ctx.hulls.find(([, l]) => l === hl) || ctx.hulls.find(([, l]) => l.toLowerCase().startsWith(hl.toLowerCase()))) : null;
    const show = (m) => { err.hidden = false; err.textContent = m; };
    if (!name) return show("Give the ship a name.");
    if (hl && !hull) return show(`No hull called "${hl}": pick one from the list, or leave it empty.`);
    try {
      const j = await post("/api/new-vessel", { vessel: { name, faction: $("#nv-fac").value.trim(), hull_ref: hull ? hull[0] : null, category: $("#nv-cat").value || null } });
      R = j.data; dlg.close();
      state.focus = { id: j.created, name };                      // show just the new ship; filters and search stay as they were
      render(); window.scrollTo(0, 0);
      const i = shown.findIndex((x) => x.vessel_id === j.created); if (i >= 0) pkOpen(shown[i], "component");
    } catch (x) { show(x.message); }
  }
  // ---- the website (GM 2026-11-13): ships are opt-in; publish.py builds the public edition from these flags
  const SHOW_LABEL = { description: "Description and card notes", captain: "Captain", names: "Ship names", tags: "Owner tags", history: "Background packages and histories" };
  async function postPublish(body) { const j = await post("/api/publish", body); R = j.data; render(); return j; }
  function openPublish(v) {
    const key = v.vessel_id || v.id, cur = (R.publish || {})[key] || {}, on = !!cur.publish;
    const show = Object.assign({ description: true, captain: true, names: true, tags: true, history: true }, cur.show || {});
    const deps = (R.publish_deps || {})[key] || [];
    const has = { description: !!(v.description || (v.abilities || []).length), captain: !!v.captain, names: !!(v.names || []).length, tags: !!(v.tags || []).length,
      history: (v.extras || []).some((e) => ["background", "machine_spirit_oddity", "past_history", "history", "complication"].includes(e.kind)) };
    $("#review-title").textContent = `Website · ${v.name}`;
    $("#review-body").innerHTML = `<p>${on ? `<b>Published.</b> On the website from the next release${cur.at ? ` (flagged ${esc(cur.at.slice(0, 10))})` : ""}.` : "<b>Private.</b> Not on the website. Ships go out only when you publish them."}</p>
      ${v.source === "book" && v.gm_only ? `<p class="warnline">An adventure ship (${esc(v.book_name || v.book)} marks it for the GM only). Publishing it shows its name, stats and loadout.</p>` : ""}
      <p class="note">Goes out: name, faction, class, stats as your campaign uses them (house rules applied), components and weapons (names and numbers), special rules (names; your own rules' text), page citations. Never book text, review notes, sheet names or other ships.</p>
      <fieldset class="frgroup"><legend>Your text on this ship</legend>${Object.entries(SHOW_LABEL).map(([k, l]) => `<label class="frrule"><input type="checkbox" data-show="${k}"${show[k] ? " checked" : ""}> <span>${esc(l)}${has[k] ? "" : ` <span class="note">(none yet)</span>`}</span></label>`).join("")}</fieldset>
      <fieldset class="frgroup"><legend>Also published because this ship uses them${deps.length ? ` (${deps.length})` : ""}</legend>${deps.length ? `<ul class="publist">${deps.map((d) => `<li>${esc(d.name)}${d.count > 1 ? ` ×${d.count}` : ""} <span class="note">${esc(d.kind)} · ${esc(d.why)}</span></li>`).join("")}</ul>` : `<p class="note">Nothing of yours: only book records.</p>`}</fieldset>
      <div class="acts">${on ? `<button class="act" id="pub-save">Save</button><button class="act danger" id="pub-off">Unpublish</button>` : `<button class="act" id="pub-on">Publish</button>`}</div><p class="note" id="pub-msg" role="status"></p>`;
    const picked = () => Object.fromEntries([...document.querySelectorAll("#review-body [data-show]")].map((x) => [x.dataset.show, x.checked]));
    const go = async (publish) => {
      try {
        if (publish && !on && v.source === "book" && v.gm_only && !(await confirmBox("Publish an adventure ship?", `${v.name} is from ${v.book_name || v.book}, an adventure. Its name, stats and loadout will be on the website.`, "Publish"))) return;
        await postPublish({ ids: [key], publish, show: publish === false ? null : picked() }); $("#review").close();
      } catch (x) { $("#pub-msg").textContent = x.message; }
    };
    $("#review-body").onclick = (e) => { if (e.target.closest("#pub-on")) go(true); else if (e.target.closest("#pub-save")) go(null); else if (e.target.closest("#pub-off")) go(false); };
    $("#review").addEventListener("close", () => { $("#review-body").onclick = null; }, { once: true });
    $("#review").showModal();
  }
  function pubBulk() {
    const list = shown.filter((v) => !v.dropped), adv = list.filter((v) => v.source === "book" && v.gm_only);
    $("#review-title").textContent = "Publish the ships shown";
    $("#review-body").innerHTML = `<p>${list.length} ship${list.length === 1 ? "" : "s"} shown (${list.filter(isPub).length} published now).</p>
      ${adv.length ? `<p class="warnline">${adv.length} of them are adventure ships the books mark for the GM only: ${esc(adv.slice(0, 8).map((v) => v.name).join(", "))}${adv.length > 8 ? " …" : ""}.</p>` : ""}
      <div class="acts"><button class="act" id="pb-on">Publish all ${list.length}</button><button class="act danger" id="pb-off">Unpublish all ${list.length}</button></div><p class="note" id="pb-msg" role="status"></p>`;
    $("#review-body").onclick = async (e) => {
      const mode = e.target.closest("#pb-on") ? true : e.target.closest("#pb-off") ? false : null;
      if (mode === null || !list.length) return;
      if (!(await confirmBox(mode ? "Publish these ships?" : "Unpublish these ships?", mode ? `Put ${list.length} ships on the website at the next release${adv.length ? `, ${adv.length} of them adventure ships` : ""}?` : `Take ${list.length} ships off the website at the next release? Anything already released may have been seen.`, mode ? "Publish" : "Unpublish"))) return;
      try { await postPublish({ ids: list.map((v) => v.vessel_id || v.id), publish: mode }); $("#review").close(); } catch (x) { $("#pb-msg").textContent = x.message; }
    };
    $("#review").addEventListener("close", () => { $("#review-body").onclick = null; }, { once: true });
    $("#review").showModal();
  }
  document.addEventListener("click", async (e) => {
    const cs = e.target.closest("[data-cur]");
    if (cs) {
      e.stopPropagation();
      const v = shown[+cs.dataset.cur], k = cs.dataset.stat, pl = (v.pools || {})[k], label = STAT_LABEL[k] || k;
      const t = await promptBox(`Current ${label} of ${v.name}`, `Maximum ${pl.max}. Leave it empty to go back to the maximum.`, pl.from === "max" ? "" : String(pl.current), "Save");
      if (t === null) return;
      if (t !== "" && (!/^\d+$/.test(t) || +t > pl.max)) return alertBox(`The current ${label} is a whole number from 0 to ${pl.max}.`);
      try {
        const j = v.source === "book" ? await post("/api/decide-book", { vessel_id: v.id, key: "current", action: "set", data: { stat: k, value: t === "" ? null : +t } })
          : await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action: "set_current", field: k, data: { value: t === "" ? null : +t } });
        R = j.data; render();
      } catch (x) { alertBox(x.message); }
      return;
    }
    const pb = e.target.closest("[data-pub]");
    if (pb) { e.stopPropagation(); return openPublish(shown[+pb.dataset.pub]); }
    if (e.target.closest("#pubpreview")) return window.open("/public/", "_blank", "noopener");
    const pt = e.target.closest("[data-pubtext]");
    if (pt) { e.stopPropagation(); try { const j = await post("/api/publish-text", { id: pt.dataset.pubtext, on: pt.dataset.on === "1" }); R = j.data; renderCatalogue(); } catch (x) { alertBox(x.message); } }
  });
  // ---- faction rules (GM 2026-11-11): a faction's special rules onto many ships at once; a Klan / upgrades per ship.
  // Ships keep what they are given (no link to the set), so rules come off single ships with their ✕ as usual.
  const FR = () => R.faction_rules || {};
  const vkey = (v) => v.vessel_id || v.id;
  const hasRule = (v, id) => (v.special || []).some((x) => x.keyword === id);
  const ruleText = (r) => { const k = kwRows().find((x) => x.ref === r.id); return k ? [k.fluff, k.mechanics].filter(Boolean).join(" ") : (r.text || ""); };
  const frGroup = (gid) => Object.values(FR()).flat().find((g) => g.id === gid);
  function pickGroups(v) {                                    // the choices a ship is offered: its faction's, or one it has a rule of
    const out = [];
    for (const [f, gs] of Object.entries(FR())) for (const g of gs) {
      if (!g.pick) continue;
      const chosen = g.rules.filter((r) => hasRule(v, r.id));
      const fits = !g.classes || g.classes.includes(v.category);  // capital upgrades: capital ships
      if (chosen.length || (fits && (g.enabled_by ? hasRule(v, g.enabled_by) : v.faction === f))) out.push({ g, chosen });
    }
    return out;
  }
  function pickRowsHTML(v, i) {
    return pickGroups(v).map(({ g, chosen }) => `<div class="pickrow"><span class="label">${esc(g.name.replace(/ \(Table.*\)$/, ""))}</span> ${chosen.length
      ? chosen.map((r) => `<span class="pkchosen" title="${esc(ruleText(r))}">${esc(r.name)}</span>`).join(" · ")
      : `<span class="note">none chosen</span>`} <button class="linkbtn" data-rulepick="${i}" data-group="${esc(g.id)}" title="${esc(g.note || "")}">✎ choose</button></div>`).join("");
  }
  function rulePick(v, g) {                                   // one ship's Klan, upgrades, Chaos god...
    const one = g.pick === "one";
    $("#review-title").textContent = `${g.name} · ${v.name}`;
    const none = !g.rules.some((r) => hasRule(v, r.id));
    $("#review-body").innerHTML = `${g.note ? `<p class="note">${esc(g.note)}</p>` : ""}<div class="frlist">${one ? `<label class="frrule"><input type="radio" name="rp" value=""${none ? " checked" : ""}> <b>None</b></label>` : ""}${g.rules.map((r) => `<label class="frrule"><input type="${one ? "radio" : "checkbox"}" name="rp" value="${esc(r.id)}"${hasRule(v, r.id) ? " checked" : ""}> <span><b>${esc(r.name)}</b> <span class="frtext">${esc(ruleText(r))}</span></span></label>`).join("")}</div>
      <div class="acts"><button class="act" id="rp-save">Save</button></div><p class="note" id="rp-msg" role="status"></p>`;
    $("#rp-save").onclick = async () => {
      const want = new Set([...document.querySelectorAll('#review-body input[name="rp"]:checked')].map((x) => x.value).filter(Boolean));
      const add = g.rules.filter((r) => want.has(r.id) && !hasRule(v, r.id)).map((r) => r.id);
      const remove = g.rules.filter((r) => !want.has(r.id) && hasRule(v, r.id)).map((r) => r.id);
      if (!add.length && !remove.length) return $("#review").close();
      try { const j = await post("/api/rules", { vessel_ids: [vkey(v)], add, remove }); R = j.data; $("#review").close(); render(); }
      catch (x) { $("#rp-msg").textContent = x.message; }
    };
    $("#review").showModal();
  }
  function openFactionRules() {
    if (!API) return alertBox("Run python3 tools/voidship_roster/serve.py to give ships rules.");
    const facs = Object.keys(FR());
    if (!facs.length) return alertBox("No faction rule sets yet: run python3 tools/voidship_roster/import_faction_rules.py");
    const one = state.factions.size === 1 ? [...state.factions][0] : null;
    const st = { fac: one && FR()[one] ? one : facs[0], scope: "all", picked: null, msg: "" };
    const ships = () => (st.scope === "shown" ? shown : (R.vessels || [])).filter((v) => v.faction === st.fac && !v.dropped);
    const draw = () => {
      const groups = FR()[st.fac], list = ships(), nShown = shown.filter((v) => v.faction === st.fac && !v.dropped).length;
      const nAll = (R.vessels || []).filter((v) => v.faction === st.fac && !v.dropped).length;
      if (!st.picked) st.picked = new Set(groups.filter((g) => !g.pick && /-all$/.test(g.id)).flatMap((g) => g.rules.map((r) => r.id)));
      $("#review-title").textContent = "Faction rules";
      $("#review-body").innerHTML = `<p class="note">Give a faction's special rules to its ships in one go. Each ship keeps its own copy: take a rule off a single ship with its ✕ under Special rules. Ships that already have a rule are skipped.</p>
        <div class="frhead"><label>Faction <select id="fr-fac">${facs.map((f) => `<option${f === st.fac ? " selected" : ""}>${esc(f)}</option>`).join("")}</select></label>
          <label class="qlv"><input type="radio" name="fr-scope" value="all"${st.scope === "all" ? " checked" : ""}> All ${nAll} ${esc(st.fac)} ships</label>
          <label class="qlv"><input type="radio" name="fr-scope" value="shown"${st.scope === "shown" ? " checked" : ""}${nShown ? "" : " disabled"}> The ${nShown} shown by your filters</label></div>
        ${groups.map((g) => `<fieldset class="frgroup"><legend><label><input type="checkbox" data-frall="${esc(g.id)}"${g.rules.every((r) => st.picked.has(r.id)) ? " checked" : ""}> ${esc(g.name)}</label>${g.pick ? ` <span class="note">${g.pick === "one" ? "one per ship" : "chosen per ship"}: also on each card's ✎ choose</span>` : ""}</legend>
          ${g.note ? `<p class="note">${esc(g.note)}</p>` : ""}
          ${g.rules.map((r) => { const on = list.filter((v) => hasRule(v, r.id)).length; const k = kwRows().find((x) => x.ref === r.id);
            return `<label class="frrule"><input type="checkbox" data-fr="${esc(r.id)}"${st.picked.has(r.id) ? " checked" : ""}> <span><b>${esc(r.name)}</b>${k && k.status !== "reviewed" ? ` <span class="badge st-pending" title="Not reviewed in the catalogue yet">review</span>` : ""} <span class="note">${on ? `on ${on} of ${list.length}` : ""}${r.own ? " · your sheet" : ` · ${esc(r.source || "")}`}</span><br><span class="frtext">${esc(ruleText(r)) || `<i>no text yet</i>`}</span>${(r.sheet || []).filter((x) => x.text).map((x) => `<br><span class="note">Your ${esc(x.sheet)} sheet: <i>${esc(x.name)}${x.text ? ": " + esc(x.text) : ""}</i></span>`).join("")}</span></label>`; }).join("")}</fieldset>`).join("")}
        <div class="acts"><button class="act" id="fr-add">Add ${st.picked.size} to ${list.length} ships</button><button class="act danger" id="fr-rm">Remove ${st.picked.size} from ${list.length} ships</button></div>
        <p class="note" id="fr-msg" role="status">${esc(st.msg)}</p>`;
    };
    const go = async (mode) => {
      const ids = [...st.picked], list = ships();
      if (!ids.length || !list.length) return;
      const ok = await confirmBox(mode === "add" ? "Add faction rules" : "Remove faction rules",
        mode === "add" ? `Add ${ids.length} rule${ids.length > 1 ? "s" : ""} to ${list.length} ${st.fac} ships? Ships that already have one are skipped.`
          : `Remove ${ids.length} rule${ids.length > 1 ? "s" : ""} from ${list.length} ${st.fac} ships? Rules a book prints stay on its ship.`,
        mode === "add" ? "Add" : "Remove");
      if (!ok) return;
      try {
        const j = await post("/api/rules", { vessel_ids: list.map(vkey), [mode]: ids }); R = j.data; render();
        const c = j.created || {};
        st.msg = mode === "add" ? `Added ${c.added} rule${c.added === 1 ? "" : "s"} on ${c.ships} ship${c.ships === 1 ? "" : "s"}.` : `Removed ${c.removed} rule${c.removed === 1 ? "" : "s"} from ${c.ships} ship${c.ships === 1 ? "" : "s"}.`;
      } catch (x) { st.msg = x.message; }
      draw();
    };
    const body = $("#review-body");
    body.onchange = (e) => {
      const t = e.target;
      if (t.id === "fr-fac") { st.fac = t.value; st.picked = null; st.msg = ""; }
      else if (t.name === "fr-scope") st.scope = t.value;
      else if (t.dataset.frall) { const g = frGroup(t.dataset.frall); g.rules.forEach((r) => t.checked ? st.picked.add(r.id) : st.picked.delete(r.id)); }
      else if (t.dataset.fr) t.checked ? st.picked.add(t.dataset.fr) : st.picked.delete(t.dataset.fr);
      else return;
      draw();
    };
    body.onclick = (e) => { if (e.target.closest("#fr-add")) go("add"); else if (e.target.closest("#fr-rm")) go("remove"); };
    $("#review").addEventListener("close", () => { body.onchange = body.onclick = null; }, { once: true });
    draw(); $("#review").showModal();
  }
  document.addEventListener("click", (e) => {
    const rp = e.target.closest("[data-rulepick]");
    if (rp) { e.stopPropagation(); return rulePick(shown[+rp.dataset.rulepick], frGroup(rp.dataset.group)); }
    if (e.target.closest("#facrules")) return openFactionRules();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("#newvessel")) return openNewVessel();
    if (e.target.closest("#unfocus")) { state.focus = null; return render(); }
    if (e.target.closest("#nv-create")) return createVessel();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest(".nv-form") && e.target.tagName === "INPUT") { e.preventDefault(); createVessel(); } });
  // ---- reclassify the hull class; owner tags; a subtype's ship names
  function classBox(v) {
    return new Promise((resolve) => {
      $("#cf-title").textContent = `Hull class of ${v.name}`;
      const cur = v.category;
      $("#cf-msg").innerHTML = `Now: <b>${esc(CAT_LABEL[cur] || cur)}</b>${v.category_override ? " (your reclassification)" : ""}.
        <div class="fac-grid">${["T", "R", "F", "LC", "C", "BC", "GC", "U"].map((c) => `<label class="qlv"><input type="radio" name="cf-cls" value="${c}"${c === cur ? " checked" : ""}> ${c} · ${esc(CAT_LABEL[c])}</label>`).join("")}</div>
        ${v.category_override ? `<label class="qlv"><input type="radio" name="cf-cls" value=""> Back to the ${v.source === "book" ? "book's" : "hull's / card's"} class</label>` : ""}`;
      $("#cf-ok").textContent = "Reclassify"; $("#cf-ok").classList.remove("danger");
      const done = (val) => { cdlg.close(); $("#cf-ok").classList.add("danger"); $("#cf-ok").onclick = $("#cf-cancel").onclick = null; resolve(val); };
      $("#cf-ok").onclick = () => { const r = document.querySelector('input[name="cf-cls"]:checked'); done(r ? r.value : null); };
      $("#cf-cancel").onclick = () => done(null);
      cdlg.onclose = () => resolve(null);
      cdlg.showModal(); (document.querySelector('input[name="cf-cls"]:checked') || $("#cf-cancel")).focus();
    });
  }
  function tagBox(v) {                                        // pick existing tags (click) and/or type new ones -> list, or null
    return new Promise((resolve) => {
      const have = new Set(v.tags || []);
      const all = [...new Set((R.vessels || []).flatMap((x) => x.tags || []))].filter((t) => !have.has(t)).sort((a, b) => a.localeCompare(b));
      $("#cf-title").textContent = `Tag ${v.name}`;
      $("#cf-msg").innerHTML = `${all.length ? `Click your tags to add them:<div class="tagpick">${all.map((t) => `<button type="button" class="chip" data-tp="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("")}</div>` : ""}
        <label class="fac-new">${all.length ? "Or a new tag" : "A tag (one of your factions, e.g. House Abaoth)"}; several with commas<input type="text" id="cf-input" maxlength="200" placeholder="e.g. House Abaoth"></label>`;
      $("#cf-ok").textContent = "Add tags"; $("#cf-ok").classList.remove("danger");
      const box = $("#cf-msg");
      box.onclick = (e) => { const b = e.target.closest("[data-tp]"); if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); };
      const done = (val) => { cdlg.close(); box.onclick = null; $("#cf-ok").classList.add("danger"); $("#cf-ok").onclick = $("#cf-cancel").onclick = null; resolve(val); };
      $("#cf-ok").onclick = () => done([...box.querySelectorAll('[data-tp][aria-pressed="true"]')].map((b) => b.dataset.tp)
        .concat(($("#cf-input").value || "").split(",").map((x) => x.trim()).filter(Boolean)));
      $("#cf-cancel").onclick = () => done(null);
      $("#cf-input").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); $("#cf-ok").click(); } };
      cdlg.onclose = () => resolve(null);
      cdlg.showModal(); (box.querySelector("[data-tp]") || $("#cf-input")).focus();
    });
  }
  function textBox(v) {                                       // the description editor -> text, or null
    return new Promise((resolve) => {
      $("#cf-title").textContent = `Description of ${v.name}`;
      $("#cf-msg").innerHTML = `<textarea id="cf-text" rows="8" maxlength="4000" aria-label="Description">${esc(v.description || "")}</textarea><span class="note">Up to 4,000 characters; leave empty to clear.</span>`;
      $("#cf-ok").textContent = "Save"; $("#cf-ok").classList.remove("danger");
      const done = (val) => { cdlg.close(); $("#cf-ok").classList.add("danger"); $("#cf-ok").onclick = $("#cf-cancel").onclick = null; resolve(val); };
      $("#cf-ok").onclick = () => done($("#cf-text").value.trim()); $("#cf-cancel").onclick = () => done(null);
      cdlg.onclose = () => resolve(null);
      cdlg.showModal(); $("#cf-text").focus();
    });
  }
  async function vesselText(v, what, text) {
    try {
      const j = v.source === "book" ? await post("/api/decide-book", { vessel_id: v.id, key: what, action: "set_text", data: { text } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action: "set_text", field: what, data: { text } });
      R = j.data; render();
    } catch (x) { alertBox(x.message); }
  }
  async function vesselSet(v, what, value) {                 // what: category | tags | names
    const book = v.source === "book";
    const action = { category: "set_category", tags: "set_tags", names: "set_names" }[what];
    try {
      const j = book ? await post("/api/decide-book", { vessel_id: v.id, key: what, action, data: { [what]: value } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action, field: what === "category" ? value : null, data: { [what]: value } });
      R = j.data; render();
    } catch (x) { alertBox(x.message); }
  }
  document.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-cls]");
    if (c) { e.stopPropagation(); const v = shown[+c.dataset.cls]; const k = await classBox(v); if (k !== null && k !== (v.category_override || (k === "" ? null : v.category))) vesselSet(v, "category", k); return; }
    const a = e.target.closest("[data-addtag]");
    if (a) {
      e.stopPropagation(); const v = shown[+a.dataset.addtag];
      const picked = await tagBox(v);
      if (picked && picked.length) vesselSet(v, "tags", (v.tags || []).concat(picked));
      return;
    }
    const cp = e.target.closest("[data-captain]");
    if (cp) {
      e.stopPropagation(); const v = shown[+cp.dataset.captain];
      const t = await promptBox(`Captain of ${v.name}`, "The captain's name (leave empty to clear).", v.captain || "", "Save");
      if (t !== null && t !== (v.captain || "")) vesselText(v, "captain", t);
      return;
    }
    const dsc = e.target.closest("[data-desc]");
    if (dsc) { e.stopPropagation(); const v = shown[+dsc.dataset.desc]; const t = await textBox(v); if (t !== null && t !== (v.description || "")) vesselText(v, "description", t); return; }
    const vd = e.target.closest(".vdesc"); if (vd) { vd.classList.toggle("open"); return; }
    const r = e.target.closest("[data-rmtag]");
    if (r) {
      e.stopPropagation(); const v = shown[+r.dataset.rmtag], tag = r.dataset.tag;
      if (await confirmBox(`Remove the tag ${tag}?`, `${v.name} will no longer be tagged “${tag}”.`, "Remove")) vesselSet(v, "tags", (v.tags || []).filter((x) => x !== tag));
      return;
    }
    const n = e.target.closest("[data-names]");
    if (n) {
      e.stopPropagation(); const v = shown[+n.dataset.names];
      const t = await promptBox(`Ships of the ${v.name} kind`, "The names of the ships of this subtype, separated by commas or semicolons (e.g. Ab Aeterno; Ab Antiquo). Leave empty to clear.", (v.names || []).join("; "), "Save names");
      if (t !== null) vesselSet(v, "names", t.split(/[;,]/).map((x) => x.trim()).filter(Boolean));
    }
  }, true);
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-tagrename]"); if (!b) return;
    e.stopPropagation();
    const from = b.dataset.tagrename;
    const to = await promptBox(`Rename the tag ${from}`, "Every ship tagged with it gets the new name. Renaming onto a tag that already exists merges the two.", from, "Rename");
    if (!to || to === from) return;
    try {
      const j = await post("/api/rename-tag", { from, to }); R = j.data;
      if (state.tags.has(from)) { state.tags.delete(from); state.tags.add(to); }
      persist(); render();
    } catch (x) { alertBox(x.message); }
  }, true);
  async function renameVessel(v) {
    const book = v.source === "book";
    const name = await promptBox(`Rename ${v.name}`, book ? `The book's name stays as printed (${v.name_card || v.name}); leave empty to go back to it.` : `Your card's name is kept for reference${v.name_card ? ` (${v.name_card})` : ""}.`, v.name, "Rename");
    if (name === null || (name === v.name)) return;
    if (!name && !book) return alertBox("A ship needs a name.");
    try {
      const j = book ? await post("/api/decide-book", { vessel_id: v.id, key: "name", action: "rename_vessel", data: { name } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action: "rename_vessel", field: name });
      R = j.data; if (state.q) { state.q = name.toLowerCase(); $("#q").value = name; } render();
    } catch (x) { alertBox(x.message); }
  }
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-rename]"); if (b) { e.stopPropagation(); renameVessel(shown[+b.dataset.rename]); } }, true);
  const PK_TABS = [["component", "Components"], ["keyword", "Special rules"], ["upgrade", "Upgrades"], ["background", "Background packages"], ["complication", "Complications"]];
  const PK = { tab: "component", q: "", group: "all", type: "", fits: true, src: "all", sort: "name", dir: 1, sel: null, vid: null };
  const pkVessel = () => (R.vessels || []).find((x) => (x.vessel_id || x.id) === PK.vid);
  const fitsShip = (r, v) => { const cl = v && v.category; if (!cl || !CLASS_SET[cl]) return true; return (r.classes || []).includes("all") || (r.classes || []).some((c) => CLASS_SET[cl].includes(c)); };
  function pkRows() {
    const rows = R.component_table || [];
    if (PK.tab === "component") return rows.filter((r) => ["essential", "weapon", "supplemental"].includes(r.group) && r.origin !== "card");
    if (PK.tab === "keyword") return rows.filter((r) => r.group === "keyword");
    if (PK.tab === "upgrade") return rows.filter((r) => r.group === "upgrade");
    if (PK.tab === "background") return rows.filter((r) => r.group === "history" && /background/i.test(r.kind || ""));
    return rows.filter((r) => r.group === "history" && /complication/i.test(r.kind || ""));
  }
  function pkText(r) { return r.group === "keyword" ? [r.fluff, r.mechanics].filter(Boolean).join(" ") : ((r.extra ? R.extras[r.ref] : R.components[r.ref]) || {}).text || ""; }
  function pkOpen(v, tab, preset) {
    preset = preset || {};
    PK.vid = v.vessel_id || v.id; PK.tab = tab || "component"; PK.sel = null; PK.q = ""; PK.type = preset.type || ""; PK.loc = preset.loc || null;
    PK.group = preset.type ? "essential" : preset.loc ? "weapon" : "all";
    $("#pk-title").textContent = `Add to ${v.name}`;
    $("#pk-toast").hidden = true;
    pkRender(); pdlg.showModal(); setTimeout(() => { const q = $("#pk-q"); if (q) q.focus(); }, 0);
  }
  function pkRender() {
    const v = pkVessel(); if (!v) return;
    $("#pk-tabs").innerHTML = PK_TABS.map(([k, l]) => `<button class="pk-tab" role="tab" aria-selected="${PK.tab === k}" data-pktab="${k}">${l}</button>`).join("");
    const all = pkRows(), types = [...new Set(all.map((r) => r.kind).filter(Boolean))].sort();
    $("#pk-filters").innerHTML = `<input type="search" id="pk-q" placeholder="Search names and rules text…" value="${esc(PK.q)}" aria-label="Search">
      ${PK.tab === "component" ? `<div class="chips">${[["all", "All"], ["essential", "Essential"], ["weapon", "Weapons"], ["supplemental", "Supplementary"]].map(([k, l]) => `<button class="chip" data-pkgroup="${k}" aria-pressed="${PK.group === k}">${l}</button>`).join("")}</div>` : ""}
      <div class="pk-row">${types.length > 1 ? `<select id="pk-type" aria-label="Type"><option value="">Any type</option>${types.map((t) => `<option${PK.type === t ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}
        ${PK.tab === "component" ? `<label class="toggle"><input type="checkbox" id="pk-fits"${PK.fits ? " checked" : ""}> Fits a ${esc(CAT_LABEL[v.category] || v.category || "this")} hull</label>` : ""}
        <select id="pk-src" aria-label="Source">${[["all", "All sources"], ["book", "Books"], ["ci", "Your Content Index"], ["gm", "Your Workshop"]].map(([k, l]) => `<option value="${k}"${PK.src === k ? " selected" : ""}>${l}</option>`).join("")}</select></div>`;
    const q = PK.q.trim().toLowerCase();
    let list = all.filter((r) => (PK.group === "all" || r.group === PK.group) && (!PK.type || r.kind === PK.type) && (PK.src === "all" || r.origin === PK.src)
      && (!PK.fits || PK.tab !== "component" || fitsShip(r, v)) && (!q || (r.name || "").toLowerCase().includes(q) || pkText(r).toLowerCase().includes(q) || String(r.kind || "").toLowerCase().includes(q)));
    const seen = new Set(); list = list.filter((r) => { const k = r.ref + "|" + (r.valid || ""); if (seen.has(k)) return false; seen.add(k); return true; });
    const key = { name: (r) => r.name || "", power: (r) => (r.power_generated != null ? -r.power_generated : r.power ?? 999), space: (r) => r.space ?? 999 }[PK.sort] || ((r) => r.name || "");
    list.sort((a, b) => { const x = key(a), y = key(b); return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * PK.dir; });
    $("#pk-count").innerHTML = `${list.length} result${list.length === 1 ? "" : "s"}${PK.tab === "component" ? ` · sort: ${[["name", "Name"], ["power", "Power"], ["space", "Space"]].map(([k, l]) => `<button class="linkbtn${PK.sort === k ? " on" : ""}" data-pksort="${k}">${l}${PK.sort === k ? (PK.dir > 0 ? " ▲" : " ▼") : ""}</button>`).join(" ")}` : ""}`;
    const pw = (r) => r.power_generated != null ? `+${r.power_generated}` : fmt(r.power ?? r.power_printed);
    const wl = (w) => w && (w.strength != null || w.damage) ? `S ${fmt(w.strength)} · D ${fmt(w.damage)} · C ${fmt(w.crit)} · R ${fmt(w.range)}` : "";
    $("#pk-list").innerHTML = list.slice(0, 300).map((r, n) => `<button class="pk-item${PK.sel === r ? " on" : ""}" role="option" aria-selected="${PK.sel === r}" data-pki="${n}">
        <span class="pk-name">${esc(r.name)}${(r.flags || []).map((f) => `<span class="tag-ci tag-flag">${esc(f)}</span>`).join("")}${r.origin === "ci" ? CI_TAG : r.origin === "gm" ? `<span class="tag-ci">yours</span>` : ""}</span>
        <span class="pk-meta">${esc(r.kind || "")}${r.valid ? " · " + esc(r.valid) : ""}</span>
        ${PK.tab === "component" ? `<span class="pk-nums"><span title="Power">P ${esc(pw(r))}</span><span title="Space">S ${esc(fmt(r.space))}</span>${r.sp != null ? `<span title="Ship Points">SP ${esc(fmt(r.sp))}</span>` : ""}</span>${wl(r.weapon) ? `<span class="pk-w">${esc(wl(r.weapon))}</span>` : ""}` : ""}
      </button>`).join("") + (list.length > 300 ? `<p class="note">Showing 300 of ${list.length}; narrow the search.</p>` : "") || `<p class="note">Nothing matches. Clear the search or untick "Fits".</p>`;
    PK.list = list;
    pkDetail();
  }
  function pkDetail() {
    const v = pkVessel(), r = PK.sel, box = $("#pk-detail");
    if (!r) { box.innerHTML = `<p class="note">Pick an item to see its full rules and add it to ${esc(v ? v.name : "the ship")}.</p>${pkOnShip(v)}`; return; }
    const w = r.weapon, isW = PK.tab === "component" && (r.group === "weapon" || (w && (w.strength != null || w.damage)));
    const used = {}; (v.components || []).forEach((c) => { used[c.location] = (used[c.location] || 0) + 1; });
    const cap = (v.hull_row || {}).weapon_capacity;
    const parsed = r.parsed || null;
    box.innerHTML = `<h4>${esc(r.name)}</h4><p class="meta">${esc(r.kind || "")}${r.valid ? " · " + esc(r.valid) : ""} · ${esc(r.source || "")}</p>
      ${PK.tab === "component" ? `<table class="devtable"><tr><th>Power</th><th>Space</th><th>SP</th>${isW ? "<th>Str</th><th>Dmg</th><th>Crit</th><th>Range</th>" : ""}</tr>
        <tr><td class="num">${esc(r.power_generated != null ? "+" + r.power_generated + " gen" : fmt(r.power ?? r.power_printed))}</td><td class="num">${esc(fmt(r.space))}</td><td class="num">${esc(fmt(r.sp))}</td>${isW ? `<td class="num">${esc(fmt(w.strength))}</td><td class="num">${esc(fmt(w.damage))}</td><td class="num">${esc(fmt(w.crit))}</td><td class="num">${esc(fmt(w.range))}</td>` : ""}</tr></table>
        ${!fitsShip(r, v) ? `<p class="note warnline">Not listed for a ${esc(CAT_LABEL[v.category] || v.category)} hull: it will be flagged for review.</p>` : ""}` : ""}
      ${r.fluff ? `<p class="kwfluff">${esc(r.fluff)}</p>` : ""}
      <div class="pk-text">${esc(pkText(r) || "No rules text recorded.")}</div>
      ${parsed && parsed.reads.length ? `<p class="parsed-line">Reads as: ${esc(parsed.reads.map((x) => x.what + (x.conditional ? " (conditional)" : "")).join(" · "))}</p>` : ""}
      ${isW ? `<label class="pk-loc">Weapon slot <select id="pk-loc">${["prow", "dorsal", "port", "starboard", "keel", "aft", "unslotted"].map((l) => `<option value="${l}"${PK.loc === l ? " selected" : ""}>${esc(LOC_LABEL[l] || l)}${used[l] ? ` (${used[l]} there now)` : ""}</option>`).join("")}</select></label>${cap ? `<p class="note">Hull capacity: ${esc(cap)}</p>` : ""}` : ""}
      <div class="acts"><button class="act primary" id="pk-add">Add to ${esc(v.name)}</button></div>${pkOnShip(v)}`;
  }
  function pkOnShip(v) {
    if (!v) return "";
    const rem = (v.removed_items || []);
    return rem.length ? `<div class="sub">Removed from the book's loadout</div>${rem.map((x) => `<div class="pk-rem">${esc(x.name)} <button class="linkbtn" data-pkrestore="${x.i}">Restore</button></div>`).join("")}` : "";
  }
  async function pkAdd() {
    const v = pkVessel(), r = PK.sel; if (!v || !r) return;
    const loc = ($("#pk-loc") || {}).value || null, book = v.source === "book";
    let body;
    if (PK.tab === "component") body = book ? { key: "loadout", action: "add_component", data: { ref: r.ref, location: loc } } : { target: { vessel: true }, action: "add_component", data: { ref: r.ref, location: loc } };
    else if (PK.tab === "keyword") {
      const k = { id: r.ref, name: r.name, text: r.text_original || r.mechanics };
      body = book ? { key: "loadout", action: "add_keyword", data: k }
        : { target: { vessel: true }, action: "set_keywords", data: { keywords: (v.special || []).filter((x) => x.keyword).map((x) => { const kr = kwRows().find((y) => y.ref === x.keyword); return { id: x.keyword, name: x.name, text: kr ? (kr.text_original || kr.mechanics) : x.text }; }).concat([k]) } };
    } else body = book ? { key: "loadout", action: "add_extra", data: { ref: r.ref } } : { target: { vessel: true }, action: "add_extra", data: { ref: r.ref } };
    try {
      const j = book ? await post("/api/decide-book", Object.assign({ vessel_id: v.id }, body)) : await post("/api/decide", Object.assign({ vessel_id: v.vessel_id }, body));
      R = j.data; render();
      const t = $("#pk-toast"); t.textContent = `Added ${r.name} to ${v.name}. Its values are recalculated.`; t.hidden = false;
      clearTimeout(pkAdd.t); pkAdd.t = setTimeout(() => { t.hidden = true; }, 4000);
      pkDetail();
    } catch (x) { const t = $("#pk-toast"); t.textContent = x.message; t.hidden = false; }
  }
  async function removeItem(b) {
    const v = shown[+b.dataset.v]; if (!v) return;
    const kind = b.dataset.rm, name = b.dataset.name || "this item", book = v.source === "book";
    const what = { component: "component", extra: (b.dataset.kind || "entry"), keyword: "special rule" }[kind];
    const extra = book && !b.dataset.added ? " It's in the book's stat block; you can restore it from the Add dialog." : "";
    if (!(await confirmBox(`Remove ${name}?`, `Remove the ${what} “${name}” from ${v.name}? Its values leave the ship and everything is recalculated.${extra}`, "Remove"))) return;
    try {
      let j;
      if (book) {
        const data = b.dataset.added ? { added: +b.dataset.added } : kind === "component" ? { index: +b.dataset.idx } : { ref: b.dataset.ref || null, name };
        j = await post("/api/decide-book", { vessel_id: v.id, key: "loadout", action: `remove_${kind}`, data });
      } else if (kind === "component") j = await post("/api/decide", { vessel_id: v.vessel_id, target: { component: b.dataset.uid }, action: "remove_component" });
      else if (kind === "extra") j = await post("/api/decide", { vessel_id: v.vessel_id, target: { upgrade: b.dataset.uid }, action: "remove_extra" });
      else {
        const list = (v.special || []).filter((x) => x.keyword && x.name !== name).map((x) => { const kr = kwRows().find((y) => y.ref === x.keyword); return { id: x.keyword, name: x.name, text: kr ? (kr.text_original || kr.mechanics) : x.text }; });
        j = await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action: "set_keywords", data: { keywords: list } });
      }
      R = j.data; render();
    } catch (x) { alertBox(x.message); }
  }
  document.addEventListener("click", async (e) => {
    const rm = e.target.closest("[data-rm]"); if (rm) { e.preventDefault(); e.stopPropagation(); return removeItem(rm); }
    const op = e.target.closest("[data-pick]"); if (op) { e.stopPropagation(); return pkOpen(shown[+op.dataset.pick], op.dataset.picktab, { type: op.dataset.pickrole, loc: op.dataset.pickloc }); }
    if (!e.target.closest("#picker")) return;
    if (e.target.closest("#pk-close")) return pdlg.close();
    const t = e.target.closest("[data-pktab]"); if (t) { PK.tab = t.dataset.pktab; PK.sel = null; PK.type = ""; PK.group = "all"; return pkRender(); }
    const g = e.target.closest("[data-pkgroup]"); if (g) { PK.group = g.dataset.pkgroup; PK.type = ""; return pkRender(); }
    const so = e.target.closest("[data-pksort]"); if (so) { PK.dir = PK.sort === so.dataset.pksort ? -PK.dir : 1; PK.sort = so.dataset.pksort; return pkRender(); }
    const it = e.target.closest("[data-pki]"); if (it) { PK.sel = PK.list[+it.dataset.pki]; document.querySelectorAll(".pk-item").forEach((x) => { x.classList.toggle("on", x === it); x.setAttribute("aria-selected", String(x === it)); }); return pkDetail(); }
    if (e.target.closest("#pk-add")) return pkAdd();
    const rs = e.target.closest("[data-pkrestore]");
    if (rs) { const v = pkVessel(); try { const j = await post("/api/decide-book", { vessel_id: v.id, key: "loadout", action: "restore", data: { removed: +rs.dataset.pkrestore } }); R = j.data; render(); pkDetail(); } catch (x) { alertBox(x.message); } }
  }, true);
  document.addEventListener("input", (e) => { if (e.target.id === "pk-q") { PK.q = e.target.value; clearTimeout(pkRender.t); pkRender.t = setTimeout(() => { pkRender(); const q = $("#pk-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 150); } });
  document.addEventListener("change", (e) => {
    if (e.target.id === "pk-type") { PK.type = e.target.value; pkRender(); }
    if (e.target.id === "pk-fits") { PK.fits = e.target.checked; pkRender(); }
    if (e.target.id === "pk-src") { PK.src = e.target.value; pkRender(); }
  });
  document.addEventListener("keydown", (e) => {                // arrow keys move through the results; Enter adds
    if (!pdlg.open || !e.target.closest("#pk-list, #pk-q")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...document.querySelectorAll(".pk-item")], i = items.findIndex((x) => x.classList.contains("on"));
      const n = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]; if (n) { n.click(); n.focus(); }
    }
  });
  function adjOf(v, c) {                                      // how a book ship's component differs from the book, kept visible
    if (v.source !== "book") return [];
    const out = [];
    if (c.swapped && c.swapped.action === "split") out.push(`Split: the book prints “${c.swapped.book_name}” as one entry`);
    else if (c.swapped) out.push(c.swapped.action === "use_stats_of" ? `Uses the stats of ${c.record_name || c.name} (the book prints ${c.swapped.book_name})` : `Swapped: the book prints ${c.swapped.book_name}`);
    if (c.name_override) out.push(`Renamed: the book prints ${c.name_printed}`);
    if (c.quality_printed !== undefined && (c.quality_printed || null) !== (c.quality || null)) out.push(`Craftsmanship: the book prints ${c.quality_printed ? QUALITY[c.quality_printed] : "Common"}`);
    return out;
  }
  function modRowsHTML(v, i, c, idx) {                       // modifications fitted to a component: rows of their own, under it
    return (c.modifications || []).map((m) => {
      const r = R.components[m.ref] || {};
      const tipText = `${m.name}${(m.flags || []).length ? " (" + m.flags.join(", ") + ")" : ""}: a modification of ${c.name}. ${m.changes_text !== "—" ? "Changes: " + m.changes_text + ". " : ""}${(m.effects || []).length ? "Effects: " + m.effects.join(", ") + ". " : ""}It works while ${c.name} does.\n\n${r.text || ""}`;
      return `<div class="comp modrow${(c.statuses || []).some((x) => x !== "on_fire") ? " off" : ""}" tabindex="0" title="${esc(tipText)}"><span class="nm"><span class="modarrow">↳</span>${esc(m.name)}<span class="tag-ci tag-mod">mod</span></span><span></span><span class="p">—</span><span class="s">—</span>${API ? "<span></span>" : ""}<span class="wp">${esc([m.changes_text !== "—" ? m.changes_text + " (applied to the row above)" : "", ...(m.effects || [])].filter(Boolean).join(" · "))}</span></div>`;
    }).join("");
  }
  const CRAFT_SHORT = { poor: "P", common: "C", good: "G", best: "B" };
  function craftCell(v, i, c, idx) {                         // Component Craftsmanship: a quiet letter; click to change it
    if (c.kind === "hull") return "<span></span>";
    const q = c.quality || "common", name = q === "common" ? "Common" : QUALITY[q];
    const opts = (c.quality_choice || []).length ? ` (options: ${[].concat(c.quality_choice).join(", ")})` : "";
    const printed = c.quality_printed !== undefined && (c.quality_printed || "common") !== q ? ` · the book prints ${c.quality_printed ? QUALITY[c.quality_printed] : "Common"}` : "";
    const fitting = fitsFor(c);
    const can = API && (c.quality_rules || fitting.length) && (v.source === "book" ? c.index != null : !!c.uid);
    const tip = `${name} craftsmanship${opts}${printed}${can ? ` · click to change${fitting.length ? " or fit a modification" : ""}` : c.quality_rules ? "" : " · no record values to change"}`;
    return can ? `<button class="crbtn cr-${q}${opts || printed ? " cr-set" : ""}" data-craft="${idx}" data-v="${i}" aria-label="${esc(c.name)}: ${esc(tip)}" title="${esc(tip)}">${CRAFT_SHORT[q]}</button>`
      : `<span class="crbtn cr-${q} off" title="${esc(tip)}">${CRAFT_SHORT[q]}</span>`;
  }
  const fitsFor = (c) => (c.type ? Object.entries(R.modifications || {}).filter(([, m]) => (m.host || []).includes(c.type)) : []);
  function openCraft(b) {
    const v = shown[+b.dataset.v], c = v && v.components[+b.dataset.craft]; if (!c) return;
    ctx = { v, c, sel: c.uid ? { uid: c.uid } : { index: c.index }, devs: [], craft: true };
    const q = c.quality || "common";
    const lv = ["poor", "common", "good", "best"].map((x) => `<label class="qlv"><input type="radio" name="qlv" value="${x}"${x === q ? " checked" : ""}> ${x === "common" ? "Common" : QUALITY[x]}</label>`).join("");
    const fitting = fitsFor(c), on = (c.modifications || []).map((m) => m.ref);
    $("#review-title").textContent = c.name;
    $("#review-body").innerHTML = `<p class="meta">${esc(v.name)}${c.type ? ` · ${esc(c.type)}` : ""}${c.quality_note ? ` · ${esc(c.quality_note)}` : ""}</p>
      ${v.source === "book" ? `<p class="note">A book ship: changes here are campaign state (like a status). The book's stat block stays as printed; "Reset to the book" undoes them.</p>` : ""}
      ${c.quality_rules ? `<div class="builder"><div class="sub">Craftsmanship</div><div class="qlvs">${lv}</div><div id="qopts"></div><button class="act" id="cr-apply">Apply craftsmanship</button></div>` : ""}
      ${fitting.length ? `<div class="builder"><div class="sub">Modifications</div>${fitting.map(([ref, m]) => `<label class="qopt"><input type="checkbox" name="cmod" value="${esc(ref)}"${on.includes(ref) ? " checked" : ""}> <b>${esc(m.name)}</b> — ${esc([m.changes_text !== "—" ? m.changes_text : "", ...(m.effects || [])].filter(Boolean).join(", ") || "see its rules text")}</label>`).join("")}
        <p class="note">A modification has no Power or Space of its own: it changes this component and works while this component does.</p><button class="act" id="mod-apply">Save modifications</button></div>` : ""}
      <p class="err" id="b-err" hidden></p>`;
    renderQualityOptions();
    tip.hidden = true;
    dlg.showModal();
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest(".crbtn[data-craft]");
    if (b) { e.preventDefault(); e.stopPropagation(); return openCraft(b); }
    if (e.target.closest("#mod-apply") && ctx && ctx.craft) {
      const { v, c } = ctx, err = $("#b-err"), refs = [...document.querySelectorAll('input[name="cmod"]:checked')].map((x) => x.value);
      try {
        const j = v.source === "book"
          ? await post("/api/decide-book", { vessel_id: v.id, key: `mods:c${c.index}`, action: "set_modifications", data: { refs } })
          : await post("/api/decide", { vessel_id: v.vessel_id, target: { component: c.uid }, action: "set_modifications", data: { refs } });
        R = j.data; render(); dlg.close();
      } catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } }
      return;
    }
    if (!e.target.closest("#cr-apply") || !ctx || !ctx.craft) return;
    const { v, c } = ctx, err = $("#b-err");
    const field = (document.querySelector('input[name="qlv"]:checked') || {}).value || "common";
    const options = [...document.querySelectorAll('input[name="qopt"]:checked')].map((x) => x.value);
    try {
      const j = v.source === "book"
        ? await post("/api/decide-book", { vessel_id: v.id, key: `quality:c${c.index}`, action: "set_quality", field, data: { options } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { component: c.uid }, action: "set_quality", field, data: { options } });
      R = j.data; render(); dlg.close();
    } catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } }
  }, true);
  function hullRowHTML(v, i) {
    const h = v.hull_row; if (!h) return "";
    const p = h.power_generated != null ? `<span class="p gen">+${esc(h.power_generated)}</span>` : `<span class="p">${esc(fmt(h.power))}</span>`;
    const hw = worst(devsFor(v, { hull: true }));
    const hadj = [h.action === "hull_stub" || h.stub ? "Marked as a stub: no hull record" : null, h.action === "hull_replace" || (h.name_was && v.source !== "book") ? `Replaced: was ${h.name_was}` : null,
      h.action === "hull_custom" ? `Made a custom hull (was ${h.name_was})` : null, h.name_override ? `Renamed${h.name_was ? `: was ${h.name_was}` : ""}` : null].filter(Boolean);
    const hname = h.name_override || h.name;
    return `<div class="loc">Hull</div><div class="comp hullrow${hw ? ` dev dev-${hw}` : ""}${hadj.length ? " adj" : ""}" tabindex="0" data-v="${i}" data-hull="1"${hw || API ? ` role="button" data-sel='{"hull":true}'` : ""} title="${API ? "Click to rename, replace, or mark this hull as custom or a stub" : ""}"><span class="nm${h.custom || h.stub ? " unresolved" : ""}">${esc(hname)}${h.ci ? CI_TAG : ""}${h.custom ? `<span class="tag-ci" title="From your custom hull register">custom</span>` : ""}${h.stub ? `<span class="tag-ci tag-mod" title="A stub: no hull record">stub</span>` : ""}${hadj.length ? `<span class="adjmark" title="${esc(hadj.join("\n"))}">⇄</span>` : ""}</span><span></span>${p}<span class="s">${esc(fmt(h.space))}</span>${API ? "<span></span>" : ""}</div>`;
  }

  let shown = [];
  function render() {
    if (!R) return;
    const all = liveVessels();
    const count = (key, skip) => pool(skip).reduce((m, v) => ((m[v[key]] = (m[v[key]] || 0) + 1), m), {});
    const facs = [...new Set(all.map((v) => v.faction).concat([...state.factions]))].sort();
    chipRow($("#f-faction"), facs, state.factions, (x) => x, count("faction", "faction"));
    chipRow($("#f-cat"), R.categories, state.cats, (x) => (x === "U" ? "Unique hull" : x), count("category", "cat"));
    const tp = pool("tags"), tc = {}; tp.forEach((v) => { (v.tags || []).forEach((t) => { tc[t] = (tc[t] || 0) + 1; }); if (!(v.tags || []).length) tc["__notag__"] = (tc["__notag__"] || 0) + 1; });
    const tags = [...new Set(all.flatMap((v) => v.tags || []).concat([...state.tags].filter((t) => t !== "__notag__")))].sort((a, b) => a.localeCompare(b));
    chipRow($("#f-tags"), tags.length ? tags.concat(["__notag__"]) : [], state.tags, (x) => (x === "__notag__" ? "No tag" : x), tc);
    if (API) $("#f-tags").querySelectorAll('.chip[data-k]').forEach((b) => { if (b.dataset.k !== "__notag__") b.insertAdjacentHTML("afterend", `<button class="tagedit" data-tagrename="${esc(b.dataset.k)}" aria-label="Rename the tag ${esc(b.dataset.k)}" title="Rename this tag on every ship">✎</button>`); });
    if (!tags.length) $("#f-tags").innerHTML = PUBLIC ? "" : `<span class="note">No owner tags yet: use “＋ tag” on a card.</span>`;
    $("#f-tags").closest(".control").hidden = PUBLIC && !tags.length;
    sourceRow();
    uniqueRow();
    hullClassPicker();
    $("#sort").value = state.sort; $("#house").checked = state.house; $("#dir").textContent = state.desc ? "↑" : "↓";
    const key = SORTS[state.sort] || SORTS.name;
    shown = all.filter((v) => matches(v)).sort((a, b) => { const x = key(a), y = key(b); const c = x < y ? -1 : x > y ? 1 : (a.name || "").localeCompare(b.name || ""); return state.desc ? -c : c; });
    const pend = all.reduce((n, v) => n + (v.deviations || []).filter((d) => d.status === "pending").length, 0);
    $("#summary").innerHTML = (state.focus ? `<span class="focusbar">Showing your new ship, ${esc(state.focus.name)}. <button class="act" id="unfocus">Show all ships</button></span> ` : "") + `${shown.length} of ${all.length} vessels` + (R.public ? "" : ` · <b>${pend}</b> values need review`)
      + (R.public ? "" : ` · ${API ? "review mode (decisions save to the vessel files)" : "read-only (run <code>python3 tools/voidship_roster/serve.py</code> to record decisions)"}`) + ` · ${R.public ? "updated" : "data built"} ${esc(R.built_at.slice(0, 10))}`;
    $("#grid").innerHTML = shown.length ? shown.map(card).join("") : `<div class="empty">No vessels match these filters.</div>`;
  }

  // ---- component modifiers tab (GM review of every modification in the components' rules texts)
  const MCAT_ORDER = ["achievement_points", "ship_characteristics", "combat_calculations", "weapon_profiles", "crew_tests",
    "travel_and_endurance", "repair_and_maintenance", "acquisition_and_trade", "other"];
  let mshown = [];
  function effectRank(e) { const v = e.value; return typeof v === "number" ? -v : 999; }
  function renderMods() {
    const M = R.modifier_catalog; const box = $("#mlist");
    if (!M) { box.innerHTML = `<p class="empty">No modifier catalogue in this build.</p>`; return; }
    const q = ($("#mq").value || "").trim().toLowerCase();
    $("#m-src").innerHTML = [["all", "All sources"], ["book", "Books"], ["ci", "Your Content Index"], ["note", "Your notes on book components"]].map(([k, l]) => `<button class="chip" data-msrc="${k}" aria-pressed="${state.msrc === k}">${l}</button>`).join("");
    mshown = M.entries.filter((e) => (state.mcond || !e.conditional) && (state.msrc === "all" || (state.msrc === "note" ? e.basis === "ci_note" : (state.msrc === "ci") === !!e.custom && e.basis !== "ci_note"))
      && (!q || [e.component, e.target, e.effect, e.condition, e.quote, e.remark, (M.categories[e.category] || {}).title].join(" ").toLowerCase().includes(q)));
    const cats = [...new Set(MCAT_ORDER.concat(Object.keys(M.categories)))].filter((c) => mshown.some((e) => e.category === c));
    $("#msummary").textContent = `${mshown.length} modifiers from ${new Set(mshown.map((e) => e.component_id)).size} components · ${mshown.filter((e) => e.conditional).length} conditional · Power and Space costs are hidden. ${M.status || ""}`;
    $("#mjump").innerHTML = cats.map((c) => `<a href="#mc-${c}">${esc((M.categories[c] || {}).title || c)} <span class="n">${mshown.filter((e) => e.category === c).length}</span></a>`).join("");
    box.innerHTML = cats.map((c) => {
      const inCat = mshown.filter((e) => e.category === c);
      const targets = [...new Set(inCat.map((e) => e.target))].sort((a, b) => a.localeCompare(b));
      return `<section class="mcat" id="mc-${c}"><h2>${esc((M.categories[c] || {}).title || c)}</h2>${(M.categories[c] || {}).description ? `<p class="note">${esc(M.categories[c].description)}</p>` : ""}`
        + targets.map((tg) => {
          const rows = inCat.filter((e) => e.target === tg);
          const effects = [...new Set(rows.map((e) => e.effect))].sort((a, b) => effectRank(rows.find((e) => e.effect === a)) - effectRank(rows.find((e) => e.effect === b)) || a.localeCompare(b));
          return `<div class="mtarget"><h3>${esc(tg)}</h3>` + effects.map((ef) => {
            const es = rows.filter((e) => e.effect === ef), plain = es.filter((e) => !e.conditional), cond = es.filter((e) => e.conditional);
            const chip = (e) => `<button class="mchip${e.custom ? " ci" : ""}${e.basis === "ci_note" ? " note" : ""}" data-m="${mshown.indexOf(e)}">${esc(e.component)}${e.custom ? CI_TAG : ""}${e.basis === "ci_note" ? `<span class="who note" title="From your Content Index note, not the book text">your note</span>` : ""}${e.basis === "gm_erratum" ? `<span class="who note" title="A GM erratum to the book component">GM erratum</span>` : ""}${e.applies_to && e.applies_to !== "this ship" ? `<span class="who">${esc(e.applies_to)}</span>` : ""}</button>`;
            return `<div class="mrow"><span class="meff">${esc(ef)}</span><div class="mcomps">`
              + (plain.length ? `<div class="mline">${plain.map(chip).join("")}</div>` : "")
              + cond.map((e) => `<div class="mline cond"><span class="ctag">conditional</span>${chip(e)}<span class="cond-text">${esc(e.condition || "")}</span></div>`).join("")
              + `</div></div>`;
          }).join("") + `</div>`;
        }).join("") + `</section>`;
    }).join("") || `<p class="empty">No modifiers match.</p>`;
  }
  // ---- component catalogue tab: every hull, component, upgrade and history in tables
  const CGROUPS = [["hull", "Hulls"], ["essential", "Essential components"], ["weapon", "Weapons"], ["supplemental", "Supplementary components"],
    ["modification", "Modifications"], ["upgrade", "Upgrades"], ["history", "Background packages and complications"], ["keyword", "Special rules"]];
  const CLASS_SET = { T: ["T"], R: ["R"], F: ["F"], LC: ["LC"], C: ["C"], BC: ["BC", "C"], GC: ["GC", "C"] };
  const COLS = {
    hull: [["name", "Name"], ["kind", "Class"], ["space", "Space", 1], ["speed", "Speed", 1], ["manoeuvrability", "Man.", 1], ["detection", "Det.", 1],
      ["armour", "Armour", 1], ["integrity", "Integrity", 1], ["turrets", "Turrets", 1], ["sp", "SP", 1], ["weapon_capacity", "Weapon capacity"], ["source", "Source"], ["text", "Rules and description"]],
    essential: [["name", "Name"], ["kind", "Kind"], ["valid", "Valid hulls"], ["power", "Power", 1], ["space", "Space", 1], ["sp", "SP", 1], ["source", "Source"], ["text", "Rules text"]],
    supplemental: null, weapon: [["name", "Name"], ["wtype", "Type"], ["valid", "Valid hulls"], ["power", "Power", 1], ["space", "Space", 1], ["sp", "SP", 1],
      ["strength", "Str", 1], ["damage", "Damage"], ["crit", "Crit", 1], ["range", "Range", 1], ["source", "Source"], ["text", "Rules text"]],
    upgrade: [["name", "Name"], ["kind", "Kind"], ["rarity", "Rarity"], ["source", "Source"], ["text", "Rules text"]], history: null,
  };
  COLS.supplemental = COLS.essential; COLS.history = COLS.upgrade;
  COLS.keyword = [["name", "Name"], ["kind", "Kind"], ["found", "Found on"], ["mech", "Fluff and mechanics"], ["status", "Review"]];
  COLS.modification = [["name", "Name"], ["modifies", "Modifies"], ["changes", "Changes to it"], ["effects", "Effects"], ["sp", "SP", 1], ["source", "Source"], ["text", "Rules text"]];
  if (API) Object.keys(COLS).forEach((g) => { if (COLS[g] && !COLS[g].some((c) => c[0] === "web")) COLS[g] = COLS[g].concat([["web", "Website"]]); });
  if (PUBLIC) {
    COLS.keyword = [["name", "Name"], ["mech", "Rules"]];
    Object.keys(COLS).forEach((g) => { if (COLS[g]) COLS[g] = COLS[g].filter((c) => c[0] !== "source"); });   // no sources on the website
  }
  function cval(r, k) {
    if (k === "web") { const p = (R.publicity || {})[r.ref]; return !p ? "" : p.class === "core" ? "Public" : p.via.length ? "Via " + p.via.join(", ") : "Private"; }
    if (k === "text") return r.group === "hull" ? r.text : ((r.extra ? R.extras[r.ref] : R.components[r.ref]) || {}).text || "";
    if (k === "power") return r.power_generated != null ? r.power_generated : r.power;
    if (k === "wtype") return (r.weapon || {}).type;
    if (["strength", "damage", "crit", "range"].includes(k)) return (r.weapon || {})[k];
    if (r.hull && k in r.hull) return r.hull[k];
    return r[k];
  }
  const num = (x) => { const m = String(x == null ? "" : x).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
  function cellHTML(r, k) {
    const v = cval(r, k);
    if (k === "web") {
      const p = (R.publicity || {})[r.ref], own = ["gm", "ci"].includes(r.origin);
      if (!p) return "";
      const off = (R.publish_text || {})[r.ref] === false;
      return `<span class="webst ${p.class === "core" ? "web-core" : p.via.length ? "web-via" : "web-priv"}" title="${p.class === "core" ? "From a book: always in the public catalogue (name, numbers, citation; never its text)" : p.via.length ? "Public because these published ships use it: " + esc(p.via.join(", ")) : "Not public: no published ship uses it"}">${esc(p.class === "core" ? "Public" : p.via.length ? `Via ${p.via.length} ship${p.via.length > 1 ? "s" : ""}` : "Private")}</span>`
        + (own ? ` <button class="mini" data-pubtext="${esc(r.ref)}" data-on="${off ? 1 : 0}" title="Your text on the website">${off ? "text hidden" : "text shown"}</button>` : "");
    }
    if (k === "found") return `<span title="${esc((r.found_all || []).join("\n"))}">${esc(r.found)}</span>`;
    if (k === "mech") {
      const pr = r.parsed, reads = pr ? pr.reads.map((x) => x.what + (x.conditional ? " (conditional)" : "")).join(" · ") : "";
      if (PUBLIC) return r.mechanics || r.fluff ? `${r.fluff ? `<div class="kwfluff">${esc(r.fluff)}</div>` : ""}<div class="rtext" tabindex="0">${esc(r.mechanics || "")}</div>` : "";
      return `${r.fluff ? `<div class="kwfluff">${esc(r.fluff)}</div>` : ""}<div class="rtext" tabindex="0" title="Click to expand">${esc(r.mechanics || "")}</div>`
        + `<div class="parsed-line">${reads ? `Reads as: ${esc(reads)}` : "Reads as: no effects"}${pr && pr.unread.length ? ` <span class="unread" title="${esc(pr.unread.join("\n"))}">· ${pr.unread.length} not understood</span>` : ""}${r.edited ? ` · <b>edited</b>` : ""}${r.variants > 1 ? ` · ${r.variants} versions of this name` : ""}</div>`;
    }
    if (k === "status" && r.group === "keyword") return `<span class="badge st-${r.status === "reviewed" ? "merged" : "pending"}">${r.status === "reviewed" ? "Reviewed" : "Needs review"}</span>${API ? ` <button class="mini" data-kwedit="${esc(r.ref)}">Edit</button>` : ""}`;
    if (k === "name") return `${esc(r.name)}${(r.flags || []).map((f) => `<span class="tag-ci tag-flag" title="${esc(f)}: a flag on the component, not its type">${esc(f)}</span>`).join("")}${r.origin === "ci" ? CI_TAG : r.origin === "card" ? `<span class="tag-ci" title="From your cards only (custom register)">card</span>` : ""}${r.errata ? `<span class="tag-ci tag-err" title="An erratum applies">erratum</span>` : ""}${r.origin === "gm" && API && (R.gm_components || {})[r.ref] ? `<button class="mini" data-catedit="${esc(r.ref)}" title="Open it in the Workshop to edit">Edit</button>` : ""}`;
    if (k === "power") return r.power_generated != null ? `<span class="gen" title="Power generated">+${esc(r.power_generated)}</span>` : esc(fmt(r.power_printed && r.power == null ? r.power_printed : v));
    if (k === "text") {
      const pr = r.parsed, reads = pr ? pr.reads.map((x) => x.what + (x.conditional ? " (conditional)" : "")).join(" · ") : "";
      const chk = pr ? `<div class="parsed-line">${reads ? `Reads as: ${esc(reads)}` : "Reads as: no effects"}${pr.unread.length ? ` <span class="unread" title="${esc(pr.unread.join("\n"))}">· ${pr.unread.length} sentence(s) not understood</span>` : ""}</div>` : "";
      return (v ? `<div class="rtext" tabindex="0" title="Click to expand">${esc(v)}</div>` : "") + chk;
    }
    return esc(fmt(v));
  }
  function renderCatalogue() {
    const rows = R.component_table || [];
    const q = ($("#cq").value || "").trim().toLowerCase();
    $("#c-group").innerHTML = [["all", "All"]].concat(CGROUPS).map(([k, l]) => `<button class="chip" data-cgroup="${k}" aria-pressed="${state.cgroup === k}">${l}</button>`).join("");
    $("#c-class").innerHTML = [["", "Any"]].concat(Object.keys(CLASS_SET).map((k) => [k, k])).map(([k, l]) => `<button class="chip" data-cclass="${k}" aria-pressed="${state.cclass === k}">${l}</button>`).join("");
    $("#c-src").innerHTML = [["all", "All"], ["book", "Books"], ["ci", "Your Content Index"], ["card", "Card-only"]].map(([k, l]) => `<button class="chip" data-csrc="${k}" aria-pressed="${state.csrc === k}">${l}</button>`).join("");
    const FLAGS = [...new Set(rows.flatMap((r) => r.flags || []))].sort();
    $("#c-flag").innerHTML = [["", "Any"]].concat(FLAGS.map((f) => [f, f])).map(([k, l]) => `<button class="chip" data-cflag="${esc(k)}" aria-pressed="${(state.cflag || "") === k}">${esc(l)}</button>`).join("");
    const okClass = (r) => !state.cclass || (r.classes || []).includes("all") || (r.classes || []).some((c) => CLASS_SET[state.cclass].includes(c));
    const list = rows.filter((r) => (state.cgroup === "all" || r.group === state.cgroup) && (state.csrc === "all" || r.origin === state.csrc) && okClass(r) && (!state.cflag || (r.flags || []).includes(state.cflag))
      && (state.cShowCustom !== false || !["gm", "ci"].includes(r.origin) || r.group === "keyword") && (state.cShowStubs !== false || r.origin !== "card")
      && (!q || (r.name || "").toLowerCase().includes(q) || String(cval(r, "text") || "").toLowerCase().includes(q) || String(r.kind || "").toLowerCase().includes(q) || (r.flags || []).join(" ").toLowerCase().includes(q) || String(r.mechanics || "").toLowerCase().includes(q) || String(r.found || "").toLowerCase().includes(q)));
    const kwPending = rows.filter((r) => r.group === "keyword" && r.status !== "reviewed").length;
    $("#csummary").innerHTML = PUBLIC ? `${list.length} of ${rows.length} rows · one row per size profile`
      : `${list.length} of ${rows.length} rows · one row per size profile · click a column to sort, a rules text to expand · <b>${kwPending}</b> special rules need review${API ? ` <button class="mini" data-kwnew="1">New special rule</button>` : ""}`;
    $("#clist").innerHTML = CGROUPS.filter(([g]) => list.some((r) => r.group === g)).map(([g, title]) => {
      const cols = COLS[g], s = state.csort[g] || { k: "name", d: 1 };
      const rs = list.filter((r) => r.group === g).sort((a, b) => {
        const col = cols.find((c) => c[0] === s.k) || cols[0], x = cval(a, s.k), y = cval(b, s.k);
        if (col[2]) { const nx = num(x), ny = num(y); if (nx == null && ny == null) return 0; if (nx == null) return 1; if (ny == null) return -1; return (nx - ny) * s.d; }
        return String(x || "").localeCompare(String(y || "")) * s.d;
      });
      return `<section class="mcat"><h2>${esc(title)} <span class="n">${rs.length}</span></h2><div class="tscroll"><table class="ctable g-${g}"><thead><tr>${cols.map(([k, l, n]) =>
        `<th class="${n ? "num" : ""}${k === "text" ? " wide" : ""}"><button class="sorter" data-cg="${g}" data-ck="${k}">${esc(l)}${s.k === k ? (s.d > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("")}</tr></thead>
        <tbody>${rs.map((r) => `<tr>${cols.map(([k, , n]) => `<td class="${n ? "num" : ""}${k === "text" ? " wide" : ""}">${cellHTML(r, k)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>`;
    }).join("") || `<p class="empty">Nothing matches.</p>`;
  }
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-cgroup]"); if (g) { state.cgroup = g.dataset.cgroup; persist(); return renderCatalogue(); }
    const c = e.target.closest("[data-cclass]"); if (c) { state.cclass = c.dataset.cclass; persist(); return renderCatalogue(); }
    const s = e.target.closest("[data-csrc]"); if (s) { state.csrc = s.dataset.csrc; persist(); return renderCatalogue(); }
    const fl = e.target.closest("[data-cflag]"); if (fl) { state.cflag = fl.dataset.cflag; persist(); return renderCatalogue(); }
    const so = e.target.closest(".sorter");
    if (so) { const cur = state.csort[so.dataset.cg] || { k: "name", d: 1 }; state.csort[so.dataset.cg] = { k: so.dataset.ck, d: cur.k === so.dataset.ck ? -cur.d : 1 }; persist(); return renderCatalogue(); }
    const ce = e.target.closest("[data-catedit]"); if (ce) { wsDraft = draftFrom(ce.dataset.catedit); return setTab("ws"); }
    const rt = e.target.closest(".rtext"); if (rt) rt.classList.toggle("open");
  });
  document.addEventListener("input", (e) => { if (e.target.id === "cq") renderCatalogue(); });

  // ---- Workshop: the GM's own components (gm_components.json)
  const WS_SUBTYPES = { essential: ["Plasma drive", "Warp engine", "Gellar field", "Void shields", "Bridge", "Life sustainer", "Crew quarters", "Augur array"],
    weapon: ["Lance", "Macrobattery", "Landing bay", "Torpedo tubes", "Nova cannon", "Other weapon"],
    supplemental: ["Augments and enhancements", "Additional facilities", "Cargo and passenger", "Other"] };
  const WS_CLASSES = ["all", "T", "R", "F", "LC", "C", "BC", "GC"];
  let wsDraft = null;
  const blankDraft = () => ({ id: null, name: "", group: "supplemental", subtype: "", flags: [], host: [], changes: { space: "", power: "", power_generated: "" }, mod_sp: "", origin: "", availability: "", text: "", profiles: [{ classes: ["all"], power: "", generates: false, space: "", sp: "" }], weapon: { strength: "", damage: "", crit: "", range: "" }, link: null });
  const CLASS_BACK = { transport: "T", raider: "R", frigate: "F", light_cruiser: "LC", cruiser: "C", battlecruiser: "BC", grand_cruiser: "GC", all: "all" };
  function draftFrom(id) {
    const r = R.gm_components[id]; if (!r) return blankDraft();
    const w = r.weapon || {};
    const ch = r.changes || {};
    return { id, name: r.name, group: r.group, subtype: r.subtype || "", flags: r.flags || [], host: r.host || [],
      changes: { space: ch.space ?? "", power: ch.power ?? "", power_generated: ch.power_generated ?? "" }, mod_sp: ((r.profiles || [])[0] || {}).sp ?? "", origin: r.origin || "", availability: r.availability || "", text: r.text || "",
      profiles: (r.profiles || []).map((p) => ({ classes: (p.classes || ["all"]).map((c) => CLASS_BACK[c] || c), power: p.power_generated != null ? p.power_generated : (p.power ?? ""),
        generates: p.power_generated != null, space: p.space ?? "", sp: p.sp ?? "" })), weapon: { strength: w.strength ?? "", damage: w.damage ?? "", crit: w.crit_rating ?? "", range: w.range ?? "" }, link: null };
  }
  function renderWorkshop() {
    if (!wsDraft) wsDraft = blankDraft();
    const d = wsDraft;
    $("#ws-title").textContent = d.id ? `Edit: ${d.name}` : d.link ? `New component from the stub “${d.name}”` : "New component";
    const prof = (p, k) => `<div class="wsprof" data-p="${k}">${WS_CLASSES.map((c) => `<label class="qlv"><input type="checkbox" data-pc="${c}"${p.classes.includes(c) ? " checked" : ""}> ${c === "all" ? "All hulls" : c}</label>`).join("")}
      <label>Power <input type="number" data-pf="power" value="${esc(p.power)}"></label><label class="qlv"><input type="checkbox" data-pf="generates"${p.generates ? " checked" : ""}> generates</label>
      <label>Space <input type="number" data-pf="space" value="${esc(p.space)}"></label><label>SP <input type="number" data-pf="sp" value="${esc(p.sp)}"></label>
      ${d.profiles.length > 1 ? `<button class="mini" data-wsrm="${k}">Remove</button>` : ""}</div>`;
    $("#ws-form").innerHTML = `${!API ? `<p class="note">Read-only: run <code>python3 tools/voidship_roster/serve.py</code> to build components.</p>` : ""}
      ${d.link ? `<p class="note">Saving links the stub on ${esc(d.link.vessel_name)} to this component (its name and stats).</p>` : ""}
      <div class="wsrow"><label>Name <input type="text" id="ws-name" maxlength="120" value="${esc(d.name)}"></label></div>
      <div class="wsrow"><span class="label">Type</span>${[["essential", "Essential"], ["supplemental", "Supplementary"], ["weapon", "Weapon"], ["modification", "Modification"]].map(([k, l]) => `<label class="qlv"><input type="radio" name="ws-group" value="${k}"${d.group === k ? " checked" : ""}> ${l}</label>`).join("")}
        <label>Subtype <input type="text" id="ws-subtype" list="ws-sublist" value="${esc(d.subtype)}"></label><datalist id="ws-sublist">${(WS_SUBTYPES[d.group] || []).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>${["archeotech", "xenotech"].map((f) => `<label class="qlv" title="A flag, not a type: an archeotech bridge is still a Ship's Bridge"><input type="checkbox" data-wsflag="${f}"${(d.flags || []).includes(f) ? " checked" : ""}> ${f === "archeotech" ? "Archeotech" : "Xenotech"}</label>`).join("")}</div>
      <div class="wsrow"><label>Faction / origin <input type="text" id="ws-origin" value="${esc(d.origin)}"></label><label>Availability <input type="text" id="ws-avail" value="${esc(d.availability)}"></label></div>
      ${d.group === "modification" ? `<div class="sub">What it modifies</div><p class="note">A modification has no slot, Power or Space of its own: it changes the component it's fitted to, and its rules text effects (e.g. "+1 to the ship's Speed") count while that component works.</p>
        <div class="wsrow wshost">${(R.component_types || []).map((t) => `<label class="qlv"><input type="checkbox" data-wshost="${esc(t)}"${(d.host || []).includes(t) ? " checked" : ""}> ${esc(t)}</label>`).join("")}</div>
        <div class="wsrow">${[["space", "Space change"], ["power", "Power used change"], ["power_generated", "Power generated change"]].map(([k, l]) => `<label>${l} <input type="number" data-wsch="${k}" value="${esc(d.changes[k])}"></label>`).join("")}<label>SP <input type="number" id="ws-modsp" value="${esc(d.mod_sp)}"></label></div>`
      : `<div class="sub">Size profiles (Power and Space for the hull classes that can mount it)</div>${d.profiles.map(prof).join("")}<button class="mini" id="ws-addprof">Add a profile</button>`}
      ${d.group === "weapon" ? `<div class="sub">Weapon profile</div><div class="wsrow">${[["strength", "Strength"], ["damage", "Damage (e.g. 1d10+2)"], ["crit", "Crit Rating"], ["range", "Range"]].map(([k, l]) => `<label>${l} <input type="text" data-wf="${k}" value="${esc(d.weapon[k])}"></label>`).join("")}</div>` : ""}
      <div class="sub">Rules text</div><textarea id="ws-text" rows="5" placeholder="e.g. Sensitive: Increase the ship's Detection by +5.">${esc(d.text)}</textarea>
      <div id="ws-parse" class="parsecheck"></div>
      <p class="note">Write effects the way the books do ("Increase the ship's Detection by 5", "Provides 2 Void Shields", "+10 to Command Tests"); the parser check above shows what the roster will count.</p>
      <div class="acts"><button class="act" id="ws-save" ${API ? "" : "disabled"}>${d.id ? "Save changes" : d.link ? "Build it and link the stub" : "Create component"}</button><button class="act" id="ws-new">Clear</button></div><p class="err" id="ws-err" hidden></p>`;
    runParse();
    const mine = Object.entries(R.gm_components || {}).sort((a, b) => a[1].name.localeCompare(b[1].name));
    $("#ws-count").textContent = mine.length;
    const uses = (id) => R.vessels.filter((v) => v.components.some((c) => c.ref === id)).length;
    $("#ws-list").innerHTML = mine.length ? `<table class="ctable"><thead><tr><th>Name</th><th>Type</th><th>Valid hulls</th><th class="num">Power</th><th class="num">Space</th><th class="num">Used on</th><th></th></tr></thead><tbody>${mine.map(([id, r]) => {
      const p = (r.profiles || [])[0] || {};
      return `<tr><td>${esc(r.name)}</td><td>${esc(r.subtype || r.group)}</td><td>${esc((r.profiles || []).map((x) => x.valid_hulls).join(" / "))}</td><td class="num">${p.power_generated != null ? "+" + esc(p.power_generated) : esc(fmt(p.power))}</td><td class="num">${esc(fmt(p.space))}</td><td class="num">${uses(id)}</td>
        <td><button class="mini" data-wsedit="${esc(id)}">Edit</button>${API ? `<button class="mini" data-wsdel="${esc(id)}">Delete</button>` : ""}</td></tr>`; }).join("")}</tbody></table>` : `<p class="note">None yet. Build one here, or from a stub's “link?” box on a ship card.</p>`;
  }
  function parseHTML(rep) {
    if (!rep) return "";
    const reads = rep.reads.map((r) => `<li><b>${esc(r.what)}</b> <span class="why">${r.kind === "stat line" ? (r.conditional ? "conditional: listed, not counted in the stat line" : "counted in the ship's stat line") : (r.conditional ? "modifier list (conditional)" : "modifier list")}</span></li>`).join("");
    const unread = rep.unread.map((t) => `<li class="unread">${esc(t)}</li>`).join("");
    return (reads ? `<div class="sub">Parser check: what the roster reads</div><ul>${reads}</ul>` : `<div class="sub">Parser check</div><p class="note">Nothing in the text changes the ship's stats or modifier list.</p>`)
      + (unread ? `<div class="sub">Not understood (has a number, but no effect was read)</div><ul>${unread}</ul>` : "");
  }
  let parseTimer = null;
  function runParse() {
    const box = $("#ws-parse"), t = $("#ws-text"); if (!box || !t) return;
    clearTimeout(parseTimer);
    parseTimer = setTimeout(async () => {
      if (!API) { box.innerHTML = ""; return; }
      try { const j = await post("/api/parse", { text: t.value }); box.innerHTML = parseHTML(j.report); } catch (x) { box.innerHTML = ""; }
    }, 250);
  }
  document.addEventListener("input", (e) => { if (e.target.id === "ws-text") runParse(); });
  function readDraft() {
    const d = wsDraft;
    d.name = $("#ws-name").value; d.subtype = $("#ws-subtype").value; d.origin = $("#ws-origin").value; d.availability = $("#ws-avail").value; d.text = $("#ws-text").value;
    d.group = (document.querySelector('input[name="ws-group"]:checked') || {}).value || d.group;
    if (document.querySelector(".wsprof")) d.profiles = [...document.querySelectorAll(".wsprof")].map((row) => ({ classes: [...row.querySelectorAll("[data-pc]:checked")].map((x) => x.dataset.pc),
      power: row.querySelector('[data-pf="power"]').value, generates: row.querySelector('[data-pf="generates"]').checked,
      space: row.querySelector('[data-pf="space"]').value, sp: row.querySelector('[data-pf="sp"]').value }));
    document.querySelectorAll("[data-wf]").forEach((x) => { d.weapon[x.dataset.wf] = x.value; });
    d.flags = [...document.querySelectorAll("[data-wsflag]:checked")].map((x) => x.dataset.wsflag);
    if (document.querySelector("[data-wshost]")) {
      d.host = [...document.querySelectorAll("[data-wshost]:checked")].map((x) => x.dataset.wshost);
      document.querySelectorAll("[data-wsch]").forEach((x) => { d.changes[x.dataset.wsch] = x.value; });
      d.mod_sp = $("#ws-modsp").value;
    }
  }
  document.addEventListener("click", async (e) => {
    if (!e.target.closest("#wsview")) return;
    if (e.target.closest("#ws-addprof")) { readDraft(); wsDraft.profiles.push({ classes: [], power: "", generates: false, space: "", sp: "" }); return renderWorkshop(); }
    const rm = e.target.closest("[data-wsrm]"); if (rm) { readDraft(); wsDraft.profiles.splice(+rm.dataset.wsrm, 1); return renderWorkshop(); }
    if (e.target.closest("#ws-new")) { wsDraft = blankDraft(); return renderWorkshop(); }
    const ed = e.target.closest("[data-wsedit]"); if (ed) { wsDraft = draftFrom(ed.dataset.wsedit); return renderWorkshop(); }
    const del = e.target.closest("[data-wsdel]");
    if (del) {
      if (!confirm(`Delete ${R.gm_components[del.dataset.wsdel].name}?`)) return;
      try { const j = await post("/api/component", { action: "delete", id: del.dataset.wsdel }); R = j.data; wsDraft = blankDraft(); renderWorkshop(); } catch (x) { alertBox(x.message); }
      return;
    }
    if (e.target.closest("#ws-save")) {
      readDraft();
      const d = wsDraft, err = $("#ws-err");
      try {
        const j = await post("/api/component", { action: "save", component: { id: d.id, name: d.name, group: d.group, subtype: d.subtype, flags: d.flags || [], host: d.host || [], changes: d.changes, mod_sp: d.mod_sp, origin: d.origin, availability: d.availability,
          text: d.text, profiles: d.profiles, weapon: d.weapon }, link: d.link ? { vessel_id: d.link.vessel_id, uid: d.link.uid, index: d.link.index } : null });
        R = j.data; wsDraft = draftFrom(j.created); renderWorkshop();
        $("#ws-err").hidden = false; $("#ws-err").className = "note"; $("#ws-err").textContent = d.link ? `Saved, and the stub on ${d.link.vessel_name} now uses it.` : "Saved.";
      } catch (x) { err.hidden = false; err.className = "err"; err.textContent = x.message; }
    }
  });
  document.addEventListener("change", (e) => { if (e.target.name === "ws-group") { readDraft(); renderWorkshop(); } });

  function setTab(t) {
    state.tab = t; persist();
    document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    $("#vessel-controls").hidden = t !== "vessels"; $("#grid").hidden = t !== "vessels"; $("#summary").hidden = t !== "vessels";
    $("#modview").hidden = t !== "mods"; $("#catview").hidden = t !== "cat"; $("#wsview").hidden = t !== "ws";
    if (t === "mods") renderMods(); else if (t === "cat") renderCatalogue(); else if (t === "ws") renderWorkshop(); else render();
  }
  document.addEventListener("click", (e) => {
    const tb = e.target.closest(".tab"); if (tb) return setTab(tb.dataset.tab);
    const s = e.target.closest("[data-msrc]"); if (s) { state.msrc = s.dataset.msrc; persist(); return renderMods(); }
    const mc = e.target.closest(".mchip");
    if (mc) {                                                    // the vessels that carry this component
      const m = mshown[+mc.dataset.m]; if (!m) return;
      state.q = m.component.toLowerCase(); $("#q").value = m.component; state.source = "all"; state.factions.clear(); state.cats.clear();
      state.review = false; state.hullClass = ""; state.unique = "all"; setTab("vessels");
    }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "mq") renderMods(); });
  document.addEventListener("change", (e) => { if (e.target.id === "m-cond") { state.mcond = e.target.checked; persist(); renderMods(); } });

  // ---- side by side: a copy against its book ship
  const cmp = $("#compare");
  let cmpIdx = null;
  const letters = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const wv = (c) => c.printed_weapon || c.weapon || {};
  const pw = (c) => (c.power_generated != null ? "+" + c.power_generated : fmt(c.power));
  const bigrams = (s) => { const t = letters(s), out = []; for (let k = 0; k < t.length - 1; k++) out.push(t.slice(k, k + 2)); return out; };
  function similar(a, b) {
    const x = bigrams(a), y = bigrams(b); if (!x.length || !y.length) return 0;
    const pool = y.slice(); let hit = 0;
    x.forEach((g) => { const k = pool.indexOf(g); if (k >= 0) { hit++; pool.splice(k, 1); } });
    return (2 * hit) / (x.length + y.length);
  }
  /* Pair book components with yours: same record, then same normalised name, first in the same slot and then
     across slots (the book may not print slots), then close names in the same slot. */
  function pairUp(book, mine, locOf) {
    const pairs = [], ub = new Set(), um = new Set();
    const pass = (test, sameLoc) => mine.forEach(([m], mi) => {
      if (um.has(mi)) return;
      const k = book.findIndex(([b], j) => !ub.has(j) && (!sameLoc || locOf(b) === locOf(m)) && test(b, m));
      if (k >= 0) { ub.add(k); um.add(mi); pairs.push([book[k], mine[mi]]); }
    });
    const byRef = (b, m) => b.ref && b.ref === m.ref, byKey = (b, m) => b.key && b.key === m.key;
    pass(byRef, true); pass(byKey, true); pass(byRef, false); pass(byKey, false);
    pass((b, m) => similar(b.name, m.name) >= 0.6, true);
    mine.forEach((m, mi) => { if (!um.has(mi)) pairs.push([null, m]); });
    book.forEach((b, j) => { if (!ub.has(j)) pairs.push([b, null]); });
    return pairs;
  }
  function compareHTML(v, i) {
    const b = R.vessels.find((x) => x.id === v.based_on);
    if (!b) return `<p>The book ship this copies (${esc(v.based_on)}) isn't in the roster.</p>`;
    const edit = API, bs = stats(b).s, ms = v.stats || {};
    const cell = (x, diff) => `<td class="${diff ? "diff" : ""}">${x}</td>`;
    let n = 0;
    const statRows = Object.entries(STAT_LABEL).map(([k, l]) => {
      const a = bs[k], m = ms[k], diff = a != null && m != null && String(a) !== String(m);
      if (diff) n++;
      const d = (v.deviations || []).find((x) => x.kind === "stat" && x.field === k && x.status !== "merged");
      const acts = edit && d ? `<button class="mini" data-cmp="merge" data-tg='${JSON.stringify({ stat: k })}'>Use book</button><button class="mini" data-cmp="custom" data-tg='${JSON.stringify({ stat: k })}'>Keep mine</button>` : "";
      return `<tr><th>${esc(l)}</th>${cell(esc(fmt(a)), diff)}${cell(esc(fmt(m)), diff)}<td class="acts">${acts}</td></tr>`;
    }).join("");
    const hb = b.hull_row || {}, hm = v.hull_row || {}, hdiff = letters(hb.name) !== letters(hm.name) || String(hb.space) !== String(hm.space);
    if (hdiff) n++;
    const hullRow = `<tr><th>Hull</th>${cell(`${esc(hb.name || b.hull || "—")} · Space ${esc(fmt(hb.space))}`, hdiff)}${cell(`${esc(hm.name || v.hull || "—")} · Space ${esc(fmt(hm.space))}`, hdiff)}<td class="acts">${edit && b.hull_ref && v.hull_ref !== b.hull_ref ? `<button class="mini" data-cmp="use_book_hull" title="Point your copy at the book ship's hull record; a different Space on your card becomes a review item.">Use the book's hull</button>` : ""}${edit && (v.deviations || []).some((x) => x.kind === "hull") ? `<button class="mini" data-cmp="merge" data-tg='{"hull":true}'>Use book</button><button class="mini" data-cmp="custom" data-tg='{"hull":true}'>Keep mine</button>` : ""}</td></tr>`;
    const order = ["essential", "prow", "dorsal", "port", "starboard", "keel", "aft", "supplemental"];
    const locOf = (c) => (order.includes(c.location) ? c.location : c.kind === "essential" ? "essential" : "supplemental");
    const allPairs = pairUp(b.components.map((c, j) => [c, j]).filter(([c]) => c.kind !== "hull"),
                            v.components.map((c, j) => [c, j]).filter(([c]) => c.kind !== "hull"), locOf);
    const compRows = order.map((loc) => {
      const here = allPairs.filter(([bb, mm]) => locOf((mm || bb)[0]) === loc);
      if (!here.length) return "";
      return `<tr class="grp"><th colspan="4">${esc(LOC_LABEL[loc] || loc)}</th></tr>` + here.map(([bb, mm]) => {
        const bc = bb && bb[0], mc = mm && mm[0];
        const show = (c) => { const w = wv(c); return `<b>${esc(c.name)}</b>${c.quality ? ` <span class="q q-${esc(c.quality)}">${esc(QUALITY[c.quality])}</span>` : ""}<div class="vals">P ${esc(pw(c))} · S ${esc(fmt(c.space))}${w.strength != null || w.damage ? ` · Str ${esc(fmt(w.strength))} · Dmg ${esc(fmt(w.damage))} · Crit ${esc(fmt(w.crit))} · Rng ${esc(fmt(w.range))}` : ""}</div>`; };
        let acts = "", cls = "";
        if (bc && mc) {
          const vd = (v.deviations || []).filter((d) => d.uid === mc.uid && d.kind === "component" && d.status !== "merged");
          const wb = wv(bc), wm = wv(mc);
          const valDiff = pw(bc) !== pw(mc) || String(bc.space) !== String(mc.space) || ["strength", "damage", "crit", "range"].some((k) => wb[k] != null && wm[k] != null && String(wb[k]) !== String(wm[k])) || (bc.quality || null) !== (mc.quality || null);
          const nameDiff = letters(bc.name) !== letters(mc.name) && letters(mc.name) !== letters(mc.record_name);
          cls = valDiff || nameDiff ? "diff" : "";
          if (cls) n++;
          if (edit && mc.spelling_differs && mc.ref) acts += `<button class="mini" data-cmp="rename" data-tg='${JSON.stringify({ component: mc.uid })}' title="Change the name on your copy to &quot;${esc(mc.record_name || bc.name)}&quot;">Book spelling</button>`;
          if (edit && vd.length) acts += `<button class="mini" data-cmp="merge" data-tg='${JSON.stringify({ component: mc.uid })}'>Use book</button><button class="mini" data-cmp="custom" data-tg='${JSON.stringify({ component: mc.uid })}'>Keep mine</button>`;
          const moved = locOf(bc) !== locOf(mc) ? `<div class="vals">book lists it under ${esc(LOC_LABEL[locOf(bc)] || locOf(bc))}</div>` : "";
          return `<tr class="${cls}"><th></th><td class="${cls}">${show(bc)}${moved}</td><td class="${cls}">${show(mc)}</td><td class="acts">${acts}</td></tr>`;
        }
        n++;
        if (bc) return `<tr class="only"><th></th><td class="diff">${show(bc)}</td><td class="diff missing">— not on your copy</td><td class="acts">${edit ? `<button class="mini" data-cmp="add" data-bi="${bb[1]}">Add to mine</button>` : ""}</td></tr>`;
        return `<tr class="only"><th></th><td class="diff missing">— not in the book</td><td class="diff">${show(mc)}</td><td class="acts">${edit ? `<button class="mini" data-cmp="remove" data-tg='${JSON.stringify({ component: mc.uid })}'>Remove from mine</button>` : ""}</td></tr>`;
      }).join("");
    }).join("");
    const ex = (x) => (x.extras || []).map((e) => e.name);
    const be = ex(b), me = ex(v);
    const exRows = [...new Set(be.concat(me))].map((nm) => {
      const inB = be.some((x) => letters(x) === letters(nm)), inM = me.some((x) => letters(x) === letters(nm)), d = !(inB && inM);
      if (d) n++;
      return `<tr><th></th>${cell(inB ? esc(nm) : "—", d)}${cell(inM ? esc(nm) : "—", d)}<td></td></tr>`;
    }).join("");
    const campaign = Object.entries(v.header || {}).map(([k, x]) => `${k}: ${x}`).concat(v.magazine && v.magazine.entries.length ? [`${v.magazine.entries.length} torpedo line(s) in the magazine`] : []);
    const head = `<p class="meta">Left: <b>${esc(b.name)}</b> as printed (${esc(b.book_name)}${b.page ? " p" + b.page : ""}${state.house ? ", house rules applied" : ""}). Right: <b>${esc(v.name)}</b>, your copy (sheet ${esc(v.sheet || "—")}). ${n ? `<b>${n}</b> row(s) differ, highlighted.` : "No differences."}${v.variant ? ` Kept as a custom variant: ${esc(v.variant.reason || "")}` : ""}</p>`;
    const foot = edit ? `<label class="reason">Reason (for "keep mine" and for a custom variant)<textarea id="cmp-reason" rows="2">${esc((v.variant || {}).reason || "")}</textarea></label>
      <div class="acts"><button class="act" data-cmp="merge_into_book" title="Your copy is retired (kept in vessels/_merged/); only the book ship remains in the roster.">Merge into the book ship</button>
      <button class="act" data-cmp="keep_variant" title="Every remaining difference becomes a deliberate custom variant, with this reason.">Keep as a custom variant of ${esc(b.name)}</button></div>
      ${campaign.length ? `<p class="note">Your copy also records campaign details the book ship doesn't have (${esc(campaign.join("; "))}). Merging keeps them in the retired file, not on the book ship.</p>` : ""}
      <p class="err" id="cmp-err" hidden></p>` : `<p class="note">Read-only: run <code>python3 tools/voidship_roster/serve.py</code> to merge or keep differences.</p>`;
    return head + `<table class="cmp"><thead><tr><th></th><th>Book: ${esc(b.name)}</th><th>Yours: ${esc(v.name)}</th><th></th></tr></thead><tbody>${hullRow}<tr class="grp"><th colspan="4">Stats</th></tr>${statRows}${compRows}${exRows ? `<tr class="grp"><th colspan="4">Upgrades, background and complications</th></tr>${exRows}` : ""}</tbody></table>` + foot;
  }
  function openCompare(i) {
    cmpIdx = i; const v = shown[i]; if (!v) return;
    $("#compare-title").textContent = `${v.name} — side by side with the book`;
    $("#compare-body").innerHTML = compareHTML(v, i);
    tip.hidden = true;
    if (!cmp.open) cmp.showModal();
  }
  async function cmpAct(btn) {
    const v = shown[cmpIdx]; if (!v) return;
    const reason = ($("#cmp-reason") || {}).value || "";
    const k = btn.dataset.cmp, tg = btn.dataset.tg ? JSON.parse(btn.dataset.tg) : null;
    const err = $("#cmp-err");
    try {
      let body;
      if (k === "merge" || k === "custom") body = { target: tg, action: k, reason };
      else if (k === "rename") body = { target: tg, action: "rename" };
      else if (k === "add") body = { target: { vessel: true }, action: "add_component", data: { book_index: Number(btn.dataset.bi) } };
      else if (k === "remove") body = { target: tg, action: "remove_component" };
      else if (k === "use_book_hull") body = { target: { vessel: true }, action: "use_book_hull" };
      else if (k === "keep_variant") body = { target: { vessel: true }, action: "keep_variant", reason };
      else if (k === "merge_into_book") {
        if (!confirm(`Merge ${v.name} into the book ship? Your copy is retired and only the book ship stays in the roster.`)) return;
        body = { target: { vessel: true }, action: "merge_into_book", reason };
      }
      const j = await post("/api/decide", Object.assign({ vessel_id: v.vessel_id }, body));
      R = j.data;
      if (k === "merge_into_book") { cmp.close(); render(); return; }
      render();
      const ni = shown.findIndex((x) => x.vessel_id === v.vessel_id);
      if (ni >= 0) openCompare(ni); else cmp.close();
    } catch (e) { if (err) { err.hidden = false; err.textContent = e.message; } }
  }
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-compare]"); if (c) { e.stopPropagation(); return openCompare(+c.dataset.compare); }
    const a = e.target.closest("[data-cmp]"); if (a) { e.stopPropagation(); return cmpAct(a); }
    if (e.target.closest("#compare-close")) cmp.close();
  }, true);

  // ---- tooltip (hover, focus) for plain components
  const tip = $("#tip");
  function tipFor(el) {
    if (el.dataset.m != null) {
      const m = mshown[+el.dataset.m]; if (!m) return null;
      const rec = R.components[m.component_id] || {};
      const full = m.basis === "ci_note" ? (m.ci_note || "") : (rec.text || "");
      const i = full.indexOf(m.quote);
      const body = i >= 0 ? `${esc(full.slice(0, i))}<mark>${esc(m.quote)}</mark>${esc(full.slice(i + m.quote.length))}` : `“${esc(m.quote)}”`;
      return `<h3>${esc(m.component)}</h3><div class="src">${esc(m.basis === "ci_note" ? `Your Content Index note (${m.source})` : (m.source || ""))}${m.supersedes ? ` · supersedes ${esc(m.supersedes)}` : ""} · ${esc(m.target)} ${esc(m.effect)}${m.conditional ? " · conditional: " + esc(m.condition || "") : ""}${m.applies_to && m.applies_to !== "this ship" ? " · applies to " + esc(m.applies_to) : ""}</div>`
        + (m.remark ? `<div class="src">${esc(m.remark)}</div>` : "")
        + `<div class="fulltext">${body.replace(/\n/g, "<br>")}</div>`
        + (m.basis === "ci_note" && rec.text ? `<div class="src">Book text:</div><div class="fulltext">${esc(rec.text)}</div>` : "");
    }
    const v = shown[+el.dataset.v]; if (!v) return null;
    if (el.dataset.x != null) {
      const e = v.extras[+el.dataset.x], cat = e && e.ref ? R.extras[e.ref] : null;
      if (!e) return null;
      const qe = Object.entries(e.quality_effects || {}).map(([q, s]) => `<div class="src${q === e.quality ? " cur" : ""}"><b>${esc(QUALITY[q] || q)}:</b> ${esc([].concat(s).join(" "))}</div>`).join("");
      const where = cat ? (cat.ci ? `Your entry (custom) · ${cat.where}` : `${cat.book}${cat.page ? " p" + cat.page : ""}`) + (cat.rarity ? " · " + cat.rarity : "") : "Not matched to a book or Content Index entry";
      return `<h3>${esc(e.name)}</h3><div class="src">${esc((EXTRA_LABEL[e.kind] || e.kind) + " · " + where)}</div>${qe}${cat && cat.text ? esc(cat.text) : "No rules text recorded."}`;
    }
    if (el.dataset.t) {
      const e = ((v.magazine || {}).entries || []).find((x) => x.uid === el.dataset.t); if (!e) return null;
      const w = e.warhead ? R.components[e.warhead] : null, g = e.guidance ? R.components[e.guidance] : null;
      return `<h3>${esc(e.name)}</h3><div class="src">${esc(w ? (w.ci ? `Your entry (custom) · ${w.where}` : `${w.book}${w.page ? " p" + w.page : ""}`) : "Not matched to a torpedo type")} · ${esc(e.guidance_name)} (Torpedo Rating ${esc(e.torpedo_rating)})</div>${e.damage_book ? `<div class="src">Damage ${esc(e.damage)} under your house rule (book ${esc(e.damage_book)}).</div>` : ""}${w && w.text ? esc(w.text) : ""}${g && g.text ? `<p>${esc(g.text)}</p>` : ""}`;
    }
    if (el.dataset.hull) {
      const h = v.hull_row; if (!h) return null;
      const s = h.stats ? Object.entries({ Speed: h.stats.speed, Manoeuvrability: h.stats.manoeuvrability, Detection: h.stats.detection, "Hull Integrity": h.stats.hull_integrity, Armour: h.stats.armour, Turrets: h.stats.turret_rating, Space: h.stats.space, SP: h.stats.sp }).filter(([, x]) => x != null).map(([k, x]) => `${k} ${x}`).join(" · ") : "";
      const sp = (h.special || []).map((x) => `<p><b>${esc(x.name || "")}</b> ${esc(x.text || "")}</p>`).join("");
      return `<h3>${esc(h.name)}</h3><div class="src">${esc(h.custom ? "Custom hull (register)" : h.source || "")}${h.name_printed && h.name_printed !== h.name ? " · printed: " + esc(h.name_printed) : ""}</div>${s ? `<div class="src">${esc(s)}</div>` : ""}${h.weapon_capacity ? `<div class="src">Weapon capacity: ${esc(h.weapon_capacity)}</div>` : ""}${h.text ? esc(h.text) : (h.custom ? "A custom hull from your sheets." : "")}${sp}`;
    }
    const c = v.components[+el.dataset.c]; if (!c) return null;
    const cat = c.ref ? R.components[c.ref] : null;
    const rule = c.xenos_rule ? R.rules[c.xenos_rule] : null;
    const text = c.text || (cat && cat.text) || (rule && rule.text) || "";
    const vals = [c.power_generated != null ? `Power +${c.power_generated} (generated)` : c.power != null ? `Power ${c.power}` : null, c.space != null ? `Space ${c.space}` : null].filter(Boolean).join(" · ");
    const w = c.weapon || (c.printed_weapon) || (c.record && c.record.weapon);
    const wl = w && (w.strength != null || w.damage) ? `Strength ${fmt(w.strength)} · Damage ${fmt(w.damage)} · Crit ${fmt(w.crit)} · Range ${fmt(w.range)}` : "";
    const src = cat ? (cat.custom ? "Custom register" : cat.ci ? `Your entry (custom) · ${cat.where}` : `${cat.book}${cat.page ? " p" + cat.page : ""}`) : rule ? `${rule.book}${rule.page ? " p" + rule.page : ""} · ${rule.name}` : "No record";
    const bil = c.built_in ? `<div class="src">Built into the ${esc(c.built_in.hull || "hull")} (${esc(c.built_in.rule || "")}): Space 0 here (already in the hull's Space${c.space_record != null ? `; the component alone takes ${esc(c.space_record)}` : ""})${c.built_in.power != null ? `, Power ${esc(c.built_in.power)} from the hull's rule` : ""}.${c.virtual ? " Not on the card or stat block; the hull comes with it." : ""}</div>` : "";
    const errl = bil + ((cat || {}).gm_errata || []).map((x) => `<div class="src">GM erratum (${esc(x.id)}): ${esc(x.rule)}. ${esc(x.basis || "")}</div>`).join("");
    const modl = errl + (c.weapon_mods || []).map((m) => `<div class="src">Includes ${esc(m.source)}: ${m.delta > 0 ? "+" : ""}${esc(m.delta)} ${esc(FIELD_LABEL[m.field] || m.field)} (“${esc(m.text)}”)</div>`).join("")
      + (c.weapon_mods_inactive || []).map((m) => `<div class="src">Not applied now: ${esc(m.source)} ${m.delta > 0 ? "+" : ""}${esc(m.delta)} ${esc(FIELD_LABEL[m.field] || m.field)}; that component isn't working.</div>`).join("")
      + (c.slot_assigned ? `<div class="src">Slot assigned by the roster: the source lists it without a weapon slot.</div>` : c.location === "unslotted" ? `<div class="src">A weapon with no free slot on this hull (often one of the book's weapon options).</div>` : "")
      + ((c.statuses || []).length ? `<div class="src">Status: ${esc(c.state)}</div>` : "");
    return `<h3>${esc(c.name)}</h3><div class="src">${PUBLIC ? esc(vals) : esc(src) + (vals ? " · " + esc(vals) : "")}</div>${wl ? `<div class="src">${esc(wl)}</div>` : ""}${modl}${c.quality_note ? `<div class="src">${esc(c.quality_note)}</div>` : ""}${text ? esc(text) : (R.public ? "" : "No rules text recorded.")}`;
  }
  function place(el) {
    const r = el.getBoundingClientRect(); tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = Math.min(window.innerWidth - w - 12, Math.max(12, r.left)), y = r.bottom + 6;
    if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 6);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const showTip = (el) => { const h = tipFor(el); if (!h) return; tip.innerHTML = h; place(el); };
  document.addEventListener("mouseover", (e) => { const el = e.target.closest(".comp, .mchip"); if (el && !dlg.open) showTip(el); });
  document.addEventListener("mouseout", (e) => { if (e.target.closest(".comp, .mchip") && !e.relatedTarget?.closest?.(".comp, .mchip")) tip.hidden = true; });
  document.addEventListener("focusin", (e) => { const el = e.target.closest(".comp, .mchip"); if (el && !dlg.open) showTip(el); });
  document.addEventListener("focusout", (e) => { if (e.target.closest(".comp, .mchip")) tip.hidden = true; });
  window.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

  // ---- review popup
  const dlg = $("#review");
  let ctx = null;
  const isCheck = (d) => /(^|_)(slot|eligibility|capacity|specified|complication_limit|essential_missing)$/.test(d.kind);
  function fieldRows(devs) {
    const vals = devs.filter((d) => !isCheck(d));
    return vals.length ? `<table class="devtable"><tr><th>Field</th><th>This vessel</th><th>Record</th><th>Status</th></tr>${vals.map((d) =>
      `<tr class="dev-${esc(st(d))}"><td>${esc(FIELD_LABEL[d.field] || STAT_LABEL[d.field] || d.label || d.field)}</td><td class="num">${esc(fmt(Array.isArray(d.value) ? d.value.join(", ") : d.value))}</td><td class="num">${esc(fmt(Array.isArray(d.record) ? d.record.join(", ") : d.record))}</td><td>${esc(STATUS_LABEL[st(d)] || d.status)}${d.stale ? " · now equal to the record" : ""}${d.note ? `<div class="why">${esc(d.note)}</div>` : ""}${d.working && d.working !== d.note ? `<div class="why">${esc(d.working)}</div>` : ""}${d.reason ? `<div class="why">${esc(d.reason)}</div>` : ""}</td></tr>`).join("")}</table>` : "";
  }
  function calcHTML(devs) {                                   // the calculation behind each discrepancy, as a table
    const fmtd = (x) => (typeof x === "number" ? `(${x > 0 ? "+" : ""}${x})` : x == null ? "—" : String(x));
    return devs.filter((d) => d.calc && (d.calc.rows.length || d.calc.total != null)).map((d) => {
      const c = d.calc, label = FIELD_LABEL[d.field] || STAT_LABEL[d.field] || d.label || d.field;
      return `<table class="calc"><caption>${esc(label)}${d.kind === "book_swap" ? " — linked component" : d.kind === "book_hull" ? " — hull + components" : ""}</caption>
        ${c.rows.map((r) => `<tr${r.note && /not counted/.test(r.note) ? ' class="muted"' : ""}><td>${esc(r.label)}${r.note ? `<div class="why">${esc(r.note)}</div>` : ""}</td><td class="num">${esc(fmt(r.value))}</td></tr>`).join("")}
        <tr class="tot"><td>${esc(c.total_label)}</td><td class="num">${esc(fmt(c.total))}</td></tr>
        <tr><td>${esc(c.listed_label)}</td><td class="num">${esc(fmt(c.listed))}</td></tr>
        <tr class="diff"><td>Difference</td><td class="num">${esc(fmtd(c.difference))}</td></tr></table>`;
    }).join("");
  }
  function checkRows(devs) {
    return devs.filter(isCheck).map((d) => `<div class="check dev-${esc(st(d))}"><b>${esc(CHECK_LABEL[d.kind.replace("book_", "")] || d.label)}</b> — ${esc(STATUS_LABEL[st(d)] || d.status)}<div>${esc(d.why || d.record)}</div>${d.source ? `<div class="why">Source: ${esc(d.source)}</div>` : ""}${d.reason ? `<div class="why">${esc(d.reason)}</div>` : ""}</div>`).join("");
  }
  function openReview(el) {
    const v = shown[+el.dataset.v]; if (!v) return;
    const sel = JSON.parse(el.dataset.sel);
    const devs = devsFor(v, sel);
    const c = sel.uid ? v.components.find((x) => x.uid === sel.uid) : sel.index != null ? v.components[sel.index]
      : sel.upgrade ? v.extras.find((x) => x.uid === sel.upgrade) : null;
    ctx = { v, sel, devs, c };
    const title = sel.unique ? `${v.name}: Unique Vessel or Vessel Subtype?` : sel.specified ? "Unique vessel loadout" : sel.climit ? "Complications: one of each" : sel.essential ? `Missing: ${sel.essential}` : c ? c.name : sel.stat ? (STAT_LABEL[sel.stat] || sel.stat) : sel.hull ? `Hull: ${(v.hull_row || {}).name_override || (v.hull_row || {}).name || v.hull || ""}` : sel.capacity ? "Weapon capacity" : "Loadout";
    const rec = c && c.ref ? R.components[c.ref] : null;
    let body = `<p class="meta">${esc(v.name)} · ${esc(v.source === "book" ? `${v.book_name} p${v.page}` : v.source === "copy" ? `your copy of ${v.based_on_name}` : `custom, sheet ${v.sheet}`)}${c && c.location ? ` · ${esc(LOC_LABEL[c.location] || c.location)}` : ""}</p>`;
    if (rec) body += `<p class="meta">Record: ${esc(rec.name)} (${esc(rec.custom ? "custom register" : rec.ci ? `your ${rec.where}` : `${rec.book}${rec.page ? " p" + rec.page : ""}`)})${c.quality ? ` · ${esc(QUALITY[c.quality])} craftsmanship${c.quality_choice ? ` (options: ${esc([].concat(c.quality_choice).join(", "))})` : ""}` : ""}${c.name_printed && c.name_printed !== c.name ? ` · on your card: "${esc(c.name_printed)}"` : ""}</p>`;
    const valueDevs = devs.filter((d) => !isCheck(d));
    const checks = devs.filter(isCheck);
    if (c && c.linkable && API) {
      const sugg = (c.alias_suggestions || []).map((a) => a.ref);
      body += `<div class="builder linkpick"><div class="sub">Not linked to a record</div>
        <p class="note">“${esc(c.name_printed || c.name)}” has ${c.ref ? "only a card-only entry in your custom register" : "no record"}. Find the component it is:${v.source === "book" ? " (on a book ship this is your ruling; the book stays as printed)" : ""}</p>
        <input type="search" id="lp-q" placeholder="Search components…" value="${esc(c.name)}" aria-label="Search components to link">
        <div id="lp-list" class="lplist"></div>
        <div class="acts"><button class="act" data-relink="keep_unlinked">Leave as it is</button><button class="act" id="lp-build" title="Open the Workshop with this stub's name and values; saving links the stub to the new component">Build a custom component from this stub</button></div>
        <div class="sub">Rename this stub</div>
        <div class="renrow"><input type="text" id="lp-name" value="${esc(c.name)}" maxlength="120" aria-label="New name for this component"><button class="act" id="lp-rename">Rename</button></div>
        <p class="err" id="lp-err" hidden></p></div>`;
      ctx.suggest = sugg;
    }
    if (c && !c.linkable && API && !sel.upgrade && c.kind !== "hull" && (c.uid || c.index != null)) {
      body += `<div class="builder linkpick"><div class="sub">Replace this component</div>
        <p class="note">Search the catalogue. "Replace with it" takes its name and stats; "Use its stats" keeps this name.${v.source === "book" ? " On a book ship this is your ruling; the book stays as printed, and its stat line follows the swap (marked ⇄)." : ""}</p>
        <input type="search" id="lp-q" placeholder="Search components…" value="" aria-label="Search components to replace it with">
        <div id="lp-list" class="lplist"><p class="note">Type a name or a word (e.g. "shield", "Jovian").</p></div>
        ${v.source === "book" && c.swapped ? `<div class="acts"><button class="act" data-relink="restore">${c.split_key ? "Undo the split" : "Restore the book's component"} (${esc(c.swapped.book_name)})</button></div>` : ""}
        <p class="err" id="lp-err" hidden></p></div>`;
      ctx.suggest = [];
    }
    if (sel.hull && API) body += hullEditHTML(v);
    body += builderHTML(v, c);
    body += fieldRows(devs) + calcHTML(devs) + checkRows(devs);
    const fit = (valueDevs.find((d) => d.quality_fit) || {}).quality_fit;
    if (fit) body += `<p class="note fit">These values are within ${esc(QUALITY[c.quality])} craftsmanship: options ${esc(fit.options.join(" + "))} (${esc(fit.table)}).${fit.strict ? "" : " Strictly, lances and macrobatteries use Table 1-5 alone and other components Table 1-4 alone; this fit combines the two."}</p>`;
    if (sel.loadout && devs[0]) body += `<p class="meta">In the book, not on your card: ${esc((devs[0].record || []).join(", ") || "—")}<br>On your card, not in the book: ${esc((devs[0].value || []).join(", ") || "—")}</p>`;
    const aliases = c && c.alias_suggestions && c.alias_suggestions.length ? c.alias_suggestions : [];
    if (c && c.spelling_differs && !aliases.length && c.record_name) body += `<p class="meta">On this vessel: "${esc(c.name)}" · the record's spelling: "${esc(c.record_name)}"</p>`;
    if (aliases.length) body += `<div class="sub">Possible misspelling</div><p class="meta">"${esc(c.name)}" matches no book component exactly. Link it to a book record (this confirms the spelling as an alias everywhere it appears), or keep it as a custom component.</p>`;
    const book = v.source === "book";
    const actions = [];
    if (sel.unique) {
      const u = v.unique;
      body += `<p>Now: <b>${u.unique ? "a unique vessel" : "a vessel subtype"}</b>${u.confirmed ? "" : " (proposed)"}. ${esc(u.why)}</p>
        <p class="meta">A unique vessel is one named ship, and every component must be specified. A vessel subtype is a kind of ship (not its hull class): its members can take generated names, and its loadout may vary (xenos subtypes especially).</p>`;
      actions.push(["uq:unique", "Unique vessel", "Every component must be specified."], ["uq:class", "Vessel subtype", "Loadout may vary; names can be generated."]);
    }
    if (fit && !book) actions.push(["approve_quality", `Approve as ${QUALITY[c.quality]} craftsmanship (${fit.options.join(" + ")})`, "Records the craftsmanship options; the values then derive from the record and the overrides go away."]);
    valueDevs.filter((d) => d.link_effect).forEach((d) => {
      const cardWord = v.detached ? "The ship's own number" : "The card's number";   // de-linked from its card: no "card" wording
      actions.push([`le:merge:${d.link_effect}`, `Apply the linked component's effect (${fmt(d.value)} → ${fmt(d.record)})`, `${cardWord} doesn't count it yet.`]);
      actions.push([`le:custom:${d.link_effect}`, `${v.detached ? "Already counted" : "Already on the card"} (keep ${fmt(d.value)})`, `${cardWord} already counts this component.`]);
    });
    valueDevs.filter((d) => d.kind === "book_swap").forEach((d) => {
      actions.push([`swap:merge:${d.key}`, `Apply ${d.component}'s effect (${fmt(d.value)} → ${fmt(d.record)})`, "The printed value doesn't include it yet: the effect moves the stat line."]);
      actions.push([`swap:custom:${d.key}`, `Already in the printed value (keep ${fmt(d.value)})`, "The book's number already counts this component."]);
    });
    if (valueDevs.some((d) => d.kind !== "book_swap" && !d.link_effect) && !sel.loadout) {
      actions.push(["merge", book ? "Use the record value" : "Match the source", "The record's value applies; this vessel stops carrying its own."]);
      actions.push(["custom", book ? "Keep as printed" : "Keep as a custom variant", "Keeps this vessel's value on purpose. Give a reason."]);
      actions.push(["defer", "Defer", "Keeps the value for now and marks it to revisit."]);
    } else if (sel.loadout) {
      actions.push(["custom", "Keep my loadout", "Your card's components are deliberate. Give a reason."]);
      actions.push(["defer", "Defer", "Revisit later."]);
    }
    if (checks.length) {
      actions.push(["check:custom", "Keep it here (exception)", "This placement is deliberate. Give a reason."]);
      actions.push(["check:defer", "Defer the check", "Revisit later."]);
    }
    if (c && !book && c.ref && c.spelling_differs && c.record_name) actions.push(["rename", `Change the text to "${c.record_name}"`, "Rewrites the name on this vessel to the record's spelling. A re-import keeps the change."]);
    aliases.forEach((a) => actions.push([(sel.upgrade ? "renameup:" : "rename:") + a.ref, `Change the text to "${a.name}"`, "Rewrites the name to the record's spelling and links it (this vessel only; no alias is recorded)."]));
    aliases.forEach((a) => actions.push([(sel.upgrade ? "linkup:" : "link:") + a.ref, `Link to "${a.name}" (${a.score})`, sel.upgrade ? "Confirms the spelling everywhere; the entry then uses that record's rules." : "Confirms the spelling; the component then uses that record's values, and any card differences become review items."]));
    if (aliases.length) actions.push(["unlink", "Keep as a custom component", "Not a misspelling."]);
    if (actions.length) body += `<label class="reason">Reason (required to keep a custom variant or an exception)<textarea id="reason" rows="2" ${API ? "" : "disabled"}>${esc((devs.find((d) => d.reason) || {}).reason || "")}</textarea></label>`;
    body += `<div class="acts">${actions.map(([k, l, h]) => `<button class="act" data-act="${esc(k)}" title="${esc(h)}" ${API ? "" : "disabled"}>${esc(l)}</button>`).join("")}</div>`;
    if (!API) body += `<p class="note">Read-only: start <code>python3 tools/voidship_roster/serve.py</code> and open the page it serves to record decisions.</p>`;
    body += `<p class="err" id="err" hidden></p>`;
    $("#review-title").textContent = title;
    $("#review-body").innerHTML = body;
    renderQualityOptions();
    renderLinkList();
    renderHullList();
    tip.hidden = true;
    dlg.showModal();
  }
  async function post(path, body) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Voidship-Token": TOKEN }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({ error: "The server sent an unreadable reply." }));
    if (!res.ok) throw new Error(j.error || `The server refused the change (${res.status}).`);
    return j;
  }
  async function act(kind) {
    const { v, sel, devs } = ctx;
    const reason = ($("#reason") || {}).value || "";
    const err = $("#err");
    try {
      let j;
      const checkAct = kind.startsWith("check:") ? kind.slice(6) : null;
      if (kind.startsWith("uq:")) {
        j = v.source === "book" ? await post("/api/decide-book", { vessel_id: v.id, key: "unique", action: kind.slice(3), reason: reason || null })
          : await post("/api/decide", { vessel_id: v.vessel_id, target: { vessel: true }, action: "set_unique", field: kind.slice(3), reason });
      } else if (kind.startsWith("le:")) {
        const [, a, ...key] = kind.split(":");
        j = await post("/api/decide", { vessel_id: v.vessel_id, target: { link_effect: key.join(":") }, action: a, reason: reason || null });
      } else if (kind.startsWith("swap:")) {
        const [, a, ...key] = kind.split(":");
        j = await post("/api/decide-book", { vessel_id: v.id, key: key.join(":"), action: a, reason: reason || null });
      } else if (v.source === "book") {
        const pick = devs.filter((d) => d.kind !== "book_swap" && (checkAct ? isCheck(d) : !isCheck(d)));
        for (const d of pick) j = await post("/api/decide-book", { vessel_id: v.id, key: d.key, action: checkAct || kind, reason: reason || null });
      } else if (checkAct) {
        for (const d of devs.filter(isCheck)) {
          const target = ["capacity", "specified", "complication_limit", "essential_missing"].includes(d.kind) ? { check: d.field } : { component: sel.uid, check: d.kind };
          j = await post("/api/decide", { vessel_id: v.vessel_id, target, action: checkAct, reason });
        }
      } else {
        const target = sel.upgrade ? { upgrade: sel.upgrade } : sel.uid ? { component: sel.uid } : sel.stat ? { stat: sel.stat } : sel.hull ? { hull: true } : { loadout: true };
        if (kind === "rename") j = await post("/api/decide", { vessel_id: v.vessel_id, target, action: "rename" });
        else if (kind.startsWith("rename:")) j = await post("/api/decide", { vessel_id: v.vessel_id, target, action: "rename", ref: kind.slice(7) });
        else if (kind.startsWith("renameup:")) j = await post("/api/decide", { vessel_id: v.vessel_id, target: { upgrade: sel.upgrade }, action: "rename", ref: kind.slice(9) });
        else if (kind.startsWith("linkup:")) j = await post("/api/decide", { vessel_id: v.vessel_id, target: { upgrade: sel.upgrade }, action: "link_upgrade", ref: kind.slice(7) });
        else if (kind.startsWith("link:")) j = await post("/api/decide", { vessel_id: v.vessel_id, target, action: "link", ref: kind.slice(5) });
        else j = await post("/api/decide", { vessel_id: v.vessel_id, target, action: kind, reason });
      }
      if (j) { R = j.data; }
      dlg.close(); render();
    } catch (e) { err.hidden = false; err.textContent = e.message; }
  }
  async function step(btn) {
    const v = shown[+btn.dataset.v]; const c = v && v.components.find((x) => x.uid === btn.dataset.uid);
    if (!c || !c.variable) return;
    const nv = c.variable.value + Number(btn.dataset.step);
    try { const j = await post("/api/decide", { vessel_id: v.vessel_id, target: { component: c.uid }, action: "set_variable", field: String(nv) }); R = j.data; render(); }
    catch (e) { alertBox(e.message); }
  }
  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-act]"); if (a) return act(a.dataset.act);
    const sb = e.target.closest("[data-step]"); if (sb) { e.stopPropagation(); return step(sb); }
    if (e.target.closest("#review-close")) return dlg.close();
    const f = e.target.closest("[data-fork]");
    if (f) {
      try { const j = await post("/api/fork", { vessel_id: f.dataset.fork }); R = j.data; state.focus = { id: j.created, name: "the new variant" }; render(); window.scrollTo(0, 0); }
      catch (err) { alertBox(err.message); }
      return;
    }
    if (e.target.closest(".stsel, .stbtn, .linkpick")) return;
    const el = e.target.closest("[data-sel]"); if (el) return openReview(el);
  });
  async function decide(v, target, action, extra) {
    try { const j = await post("/api/decide", Object.assign({ vessel_id: v.vessel_id, target, action }, extra || {})); R = j.data; render(); }
    catch (err) { alertBox(err.message); }
  }
  const ent = (v, uid) => ((v.magazine || {}).entries || []).find((x) => x.uid === uid);
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ord]");
    if (b) { e.stopPropagation(); const v = shown[+b.dataset.v], o = ent(v, b.dataset.o); if (o) decide(v, { ordnance: o.uid }, "ordnance_set", { data: { count: Math.max(0, (o.count || 0) + Number(b.dataset.ord)) } }); return; }
    const rm = e.target.closest("[data-ordrm]");
    if (rm) { const v = shown[+rm.dataset.v], o = ent(v, rm.dataset.ordrm); if (o && confirm(`Remove ${o.name} from ${v.name}?`)) decide(v, { ordnance: o.uid }, "ordnance_remove"); }
  }, true);
  document.addEventListener("change", (e) => {
    const el = e.target, v = el.dataset && el.dataset.v != null ? shown[+el.dataset.v] : null; if (!v) return;
    if (el.matches("select.uq")) decide(v, { upgrade: el.dataset.u }, "set_upgrade_quality", { field: el.value });
    else if (el.matches("input.cnt") && el.value !== "") decide(v, { ordnance: el.dataset.o }, "ordnance_set", { data: { count: Number(el.value) } });
    else if (el.matches("select.ordfix") && el.value) { const o = ent(v, el.dataset.o); decide(v, { ordnance: el.dataset.o }, "ordnance_set", { data: { count: (o && o.count) || 0, warhead: el.value } }); }
  });
  document.addEventListener("click", async (e) => {         // the status button: next (shift: previous) status
    const b = e.target.closest(".stbtn"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const v = shown[+b.dataset.v]; if (!v || b.disabled) return;
    const order = STATUS_OPTS.map(([k]) => k), n = order.length;
    const next = order[(order.indexOf(b.dataset.cur) + (e.shiftKey ? n - 1 : 1)) % n];
    const statuses = next === "intact" ? [] : [next];
    b.disabled = true; b.textContent = STATUS_SHORT[next]; b.className = `stbtn st-${next} busy`;
    try {
      const j = v.source === "book"
        ? await post("/api/decide-book", { vessel_id: v.id, key: `status:c${b.dataset.idx}`, action: "set_status", data: { statuses } })
        : await post("/api/decide", { vessel_id: v.vessel_id, target: { component: b.dataset.uid }, action: "set_status", data: { statuses } });
      R = j.data; render();
    } catch (x) { alertBox(x.message); render(); }
  }, true);
  document.addEventListener("change", async (e) => {
    const ss = e.target.closest && e.target.closest(".stsel");
    if (ss && ss.value !== "") {
      const v = shown[+ss.dataset.v]; if (!v) return;
      const statuses = ss.value === "intact" ? [] : [ss.value];
      try {
        const j = v.source === "book"
          ? await post("/api/decide-book", { vessel_id: v.id, key: `status:c${ss.dataset.idx}`, action: "set_status", data: { statuses } })
          : await post("/api/decide", { vessel_id: v.vessel_id, target: { component: ss.dataset.uid }, action: "set_status", data: { statuses } });
        R = j.data; render();
      }
      catch (x) { alertBox(x.message); }
      return;
    }
    if (e.target.matches('input[name="qlv"]')) renderQualityOptions();
    if (e.target.matches('input[name="qopt"]')) { const n = document.querySelectorAll('input[name="qopt"]:checked').length, el = $("#qcount"); if (el) el.textContent = `${n} of ${el.dataset.need} chosen`; }
  });
  document.addEventListener("click", async (e) => {
    const qa = e.target.closest("#q-apply"), sa = e.target.closest("#st-apply"); if (!qa && !sa) return;
    const { v, c } = ctx, err = $("#b-err");
    try {
      let body;
      if (qa) body = { target: { component: c.uid }, action: "set_quality", field: (document.querySelector('input[name="qlv"]:checked') || {}).value || "common",
                       data: { options: [...document.querySelectorAll('input[name="qopt"]:checked')].map((x) => x.value) } };
      else body = { target: { component: c.uid }, action: "set_status", data: { statuses: [...document.querySelectorAll('input[name="cst"]:checked')].map((x) => x.value) } };
      const j = await post("/api/decide", Object.assign({ vessel_id: v.vessel_id }, body));
      R = j.data; render();
      const nv = shown.find((x) => x.vessel_id === v.vessel_id), nc = nv && nv.components.find((x) => x.uid === c.uid);
      if (nc) { ctx = Object.assign({}, ctx, { v: nv, c: nc }); const el = document.querySelector(`[data-sel='${JSON.stringify({ uid: c.uid })}'][data-v="${shown.indexOf(nv)}"]`); if (el) { openReview(el); return; } }
      dlg.close();
    } catch (x) { if (err) { err.hidden = false; err.textContent = x.message; } }
  });
  document.addEventListener("submit", (e) => {
    const f = e.target.closest("form.addtorp"); if (!f) return; e.preventDefault();
    const v = shown[+f.dataset.v], d = new FormData(f);
    decide(v, { ordnance: "new" }, "ordnance_add", { data: { warhead: d.get("warhead"), guidance: d.get("guidance") || null, count: Number(d.get("count") || 0) } });
  });
  document.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-sel]")) { e.preventDefault(); openReview(e.target); }
  });
  function alertBox(msg) { $("#summary").textContent = msg; }

  $("#f-hullclass").onchange = (e) => { state.hullClass = e.target.value; persist(); render(); };
  $("#sort").onchange = (e) => { state.sort = e.target.value; persist(); render(); };
  $("#dir").onclick = () => { state.desc = !state.desc; persist(); render(); };
  $("#house").onchange = (e) => { state.house = e.target.checked; persist(); render(); };
  async function fullRecalc() {
    const b = $("#recalc"); if (!API) return alertBox("Run python3 tools/voidship_roster/serve.py to recalculate.");
    b.disabled = true; b.textContent = "Recalculating…";
    try {
      const j = await post("/api/recalc", {}); R = j.data; render(); kwDatalist();
      const rep = j.report, sev = { error: "Error", warn: "Check", info: "Info" };
      const ORDER = ["Space total", "Power used", "Void Shields", "Over Space", "Over Power", "Recalculated from changes", "Decision on a missing component",
        "Modification on the wrong host", "Special rule deleted", "Decisions now equal the record", "Unlinked component"];
      const rank = (i) => ({ error: 0, warn: 1, info: 2 }[i.severity] * 100 + (ORDER.indexOf(i.check) + 1 || 99));
      const rows = rep.issues.filter((i) => i.severity !== "info" || !["No values", "Needs review"].includes(i.check)).sort((a, b) => rank(a) - rank(b));
      $("#review-title").textContent = "Full recalculation";
      $("#review-body").innerHTML = `<p class="meta">${rep.vessels} vessels rebuilt from their files at ${esc(rep.at)}: <b>${rep.summary.errors}</b> errors, <b>${rep.summary.warnings}</b> to check, ${rep.summary.info} notes.</p>
        <p class="note">Errors are numbers that don't add up (a bug, please report). "To check" items need your decision. Every vessel's stat line now follows its current components, hull and special rules: a card's numbers move by what changed since it was written.</p>
        <table class="devtable"><tr><th>Checks</th><th class="num">Count</th></tr>${Object.entries(rep.summary.by_check).map(([k, n]) => `<tr><td>${esc(k.replace(/^error/, "Error").replace(/^warn/, "Check").replace(/^info/, "Info"))}</td><td class="num">${n}</td></tr>`).join("")}</table>
        <div class="sub">Details (${rows.length}; "No values" and "Needs review" are summarised above)</div>
        <table class="devtable recalc"><tr><th></th><th>Vessel</th><th>Check</th><th>Detail</th></tr>${rows.map((i) => `<tr class="sev-${i.severity}"><td>${sev[i.severity]}</td><td><button class="linkbtn" data-goto="${esc(i.vessel || "")}">${esc(i.vessel || "")}</button></td><td>${esc(i.check)}</td><td>${esc(i.detail || "")}</td></tr>`).join("")}</table>`;
      tip.hidden = true; dlg.showModal();
    } catch (x) { alertBox(x.message); }
    finally { b.disabled = false; b.textContent = "Full recalculation"; }
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("#recalc")) return fullRecalc();
    const g = e.target.closest("[data-goto]");
    if (g) { dlg.close(); setTab("vessels"); state.q = g.dataset.goto.toLowerCase(); $("#q").value = g.dataset.goto; persist(); render(); }
  });
  const applyMarks = () => { document.body.classList.toggle("nomarks", state.marks === false); const m = $("#marks"); if (m) m.checked = state.marks !== false; };
  $("#marks").onchange = (e) => { state.marks = e.target.checked; persist(); applyMarks(); };
  $("#details").checked = state.showDetails !== false;
  $("#details").onchange = (e) => { state.showDetails = e.target.checked; state.cardOpen = {}; persistView(); render(); };   // overrides each card's own choice
  $("#c-custom").checked = state.cShowCustom !== false; $("#c-stubs").checked = state.cShowStubs !== false;
  $("#c-custom").onchange = (e) => { state.cShowCustom = e.target.checked; persist(); renderCatalogue(); };
  $("#c-stubs").onchange = (e) => { state.cShowStubs = e.target.checked; persist(); renderCatalogue(); };
  $("#dropped").checked = !!state.showDropped;
  $("#dropped").onchange = (e) => { state.showDropped = e.target.checked; persist(); render(); };
  applyMarks();
  $("#q").oninput = (e) => { state.q = e.target.value.trim().toLowerCase(); state.focus = null; render(); };
  $("#q").value = state.q || "";                                // the box always shows the search in force

  if (location.hash.startsWith("#vessel=")) {                   // deep link from the audit page
    state.q = decodeURIComponent(location.hash.slice(8)).toLowerCase(); state.source = "all"; state.factions.clear(); state.cats.clear(); state.review = false; state.hullClass = ""; state.unique = "all";
    $("#q").value = state.q;
  }
  $("#m-cond").checked = state.mcond !== false;
  const startTab = () => { if (["mods", "cat", "ws"].includes(state.tab)) setTab(state.tab); };
  if (API) {
    fetch("/api/data", { cache: "no-store" }).then((r) => r.json()).then((d) => { R = d; render(); startTab(); kwDatalist(); })
      .catch(() => { $("#summary").textContent = "The review server did not answer; showing the baked data read-only."; render(); });
  } else if (R) { render(); startTab(); kwDatalist(); }
  if (PUBLIC) {
    $("#eyebrow").textContent = "Rogue Trader · Koronus Expanse · public roster";
    ["#tab-mods", "#tab-ws", "#newvessel", "#facrules", "#recalc", "#pubpreview", ".legend-bar"].forEach((q) => { const el = $(q); if (el) el.hidden = true; });
    const cs = $("#c-src"); if (cs) { cs.hidden = true; if (cs.previousElementSibling) cs.previousElementSibling.hidden = true; }
    ["#house", "#dropped", "#marks", "#c-stubs"].forEach((q) => { const el = $(q); if (el && el.closest("label")) el.closest("label").hidden = true; });
    const cc = $("#c-custom"); if (cc && cc.closest("label")) cc.closest("label").hidden = true;
  } else if (!API) { const pp = $("#pubpreview"); if (pp) pp.hidden = true; }
})();
