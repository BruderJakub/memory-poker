// Memory Poker Online: host runs the game in the browser, players connect with a room code (PeerJS / WebRTC).
(() => {
  const P = window.Poker;
  const app = document.getElementById("app");
  const LET = "ABCDEFGHIJKLMNOP".split("");
  const params = new URLSearchParams(location.search);
  const LOCAL = params.has("local"); // test mode: BroadcastChannel instead of WebRTC (same browser only)
  const PREFIX = "mpk26-";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = x => String(x).replace(".", ",");
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const rid = () => Math.random().toString(36).slice(2, 10);
  const newCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");

  /* ---------- network ---------- */
  function wrapPeer(c) {
    return {
      send: m => { try { if (c.open) c.send(m); } catch (e) {} },
      onData: f => c.on("data", f),
      onClose: f => { c.on("close", f); c.on("error", f); },
      close: () => { try { c.close(); } catch (e) {} }
    };
  }
  const PeerNet = {
    host(code, onReady, onConn, onError) {
      const peer = new Peer(PREFIX + code, { debug: 0 });
      peer.on("open", onReady);
      peer.on("connection", c => c.on("open", () => onConn(wrapPeer(c))));
      peer.on("error", onError);
      peer.on("disconnected", () => { try { peer.reconnect(); } catch (e) {} });
      return { destroy: () => peer.destroy() };
    },
    join(code, onOpen, onError) {
      const peer = new Peer(undefined, { debug: 0 });
      let done = false;
      peer.on("open", () => {
        const c = peer.connect(PREFIX + code, { reliable: true });
        c.on("open", () => { done = true; onOpen(wrapPeer(c)); });
        c.on("error", e => { if (!done) onError(e); });
      });
      peer.on("error", e => { if (!done) onError(e); });
      return { destroy: () => peer.destroy() };
    }
  };
  const LocalNet = {
    host(code, onReady, onConn) {
      const bc = new BroadcastChannel(PREFIX + code);
      const conns = {};
      bc.onmessage = e => {
        const m = e.data;
        if (m.to !== "host") return;
        if (m.kind === "hello") {
          const h = { data: [], close: [] };
          conns[m.cid] = h;
          bc.postMessage({ to: m.cid, kind: "welcome" });
          onConn({ send: x => bc.postMessage({ to: m.cid, kind: "data", x }), onData: f => h.data.push(f), onClose: f => h.close.push(f), close() {} });
        } else if (m.kind === "data" && conns[m.cid]) conns[m.cid].data.forEach(f => f(m.x));
        else if (m.kind === "bye" && conns[m.cid]) conns[m.cid].close.forEach(f => f());
      };
      setTimeout(onReady, 0);
      return { destroy: () => bc.close() };
    },
    join(code, onOpen, onError) {
      const bc = new BroadcastChannel(PREFIX + code);
      const cid = rid();
      const h = { data: [], close: [] };
      let opened = false;
      bc.onmessage = e => {
        const m = e.data;
        if (m.to !== cid) return;
        if (m.kind === "welcome" && !opened) {
          opened = true;
          onOpen({ send: x => bc.postMessage({ to: "host", kind: "data", cid, x }), onData: f => h.data.push(f), onClose: f => h.close.push(f), close() {} });
        } else if (m.kind === "data") h.data.forEach(f => f(m.x));
      };
      addEventListener("beforeunload", () => bc.postMessage({ to: "host", kind: "bye", cid }));
      bc.postMessage({ to: "host", kind: "hello", cid });
      setTimeout(() => { if (!opened) onError({ type: "peer-unavailable" }); }, 1500);
      return { destroy: () => bc.close() };
    }
  };
  const Net = LOCAL ? LocalNet : PeerNet;

  /* ---------- shared rendering ---------- */
  function cardHTML(c, opts = {}) {
    const red = c && (c.s === 1 || c.s === 2);
    const face = c ? '<div class="face' + (red ? " r" : "") + '"><span class="rk">' + P.rn(c.r) + '</span><span class="st">' + P.SUITS[c.s] + "</span></div>" : '<div class="face"></div>';
    const tag = opts.button ? "button" : "div";
    const attrs = opts.button ? ' type="button" data-l="' + opts.label + '" aria-label="Karte ' + opts.label + '"' : ' aria-label="' + (c && !opts.down ? P.rn(c.r) + " " + P.SUITS[c.s] : "verdeckte Karte " + (opts.label || "")) + '"';
    return "<" + tag + ' class="card' + (opts.down ? " down" : "") + (opts.cls || "") + '"' + attrs + '><div class="in">' + face + '<div class="back"><b>' + (opts.label || "") + "</b></div></div></" + tag + ">";
  }
  function tableHTML(v, opts = {}) {
    const hl = {};
    if (v.picks) {
      (v.picks.a.letters || []).forEach(l => (hl[l] = (hl[l] || "") + " pa"));
      (v.picks.b.letters || []).forEach(l => (hl[l] = (hl[l] || "") + " pb"));
    }
    const sel = opts.selected || [];
    const grid = LET.map((l, i) => {
      const c = v.cards ? v.cards[i] : null;
      return '<div class="slot"><span class="tag">' + l + "</span>" + cardHTML(c, { down: !c, label: l, button: opts.clickable, cls: (hl[l] || "") + (sel.includes(l) ? " sel" : "") }) + "</div>";
    }).join("");
    const comm = (v.comm || [null, null, null]).map(c => cardHTML(c, { down: !c, label: "?" })).join("");
    return '<div class="grid">' + grid + '</div><div class="comm"><span class="small">Gemeinschaftskarten</span>' + comm + "</div>";
  }
  function boardHTML(players, me) {
    const rows = players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    let rank = 0, prev = null;
    return '<table class="podium"><tr><th>#</th><th>Name</th><th class="n">Punkte</th><th class="n">Spiele</th></tr>' +
      rows.map((p, k) => { if (p.score !== prev) { rank = k + 1; prev = p.score; } return '<tr class="' + (p.i === me ? "me" : "") + '"><td>' + rank + ".</td><td>" + esc(p.name) + '</td><td class="n">' + fmt(p.score) + '</td><td class="n">' + p.played + "</td></tr>"; }).join("") + "</table>";
  }
  function resultHTML(v) {
    const r = v.result, A = v.players[v.a], B = v.players[v.b];
    const win = r.winner === "A" ? esc(A.name) + " gewinnt!" : r.winner === "B" ? esc(B.name) + " gewinnt!" : r.winner === "draw" ? "Unentschieden: je 0,5 Punkte" : "Keine gültige Auswahl: kein Punkt";
    const hand = (side, p, pk, desc, valid) => '<div class="hand ' + side + '"><div class="who">' + esc(p.name) + "</div><div>" + (valid ? esc(pk.letters.join(" + ")) : "keine gültige Auswahl") + '</div><div class="small">' + esc(desc || "") + "</div></div>";
    return '<div class="result"><div class="win">' + win + '</div><div class="hands">' + hand("a", A, v.picks.a, r.da, r.validA) + hand("b", B, v.picks.b, r.db, r.validB) + "</div></div>";
  }

  // size the 4×4 grid on the host screen so it fills its area without scrolling
  function fitCards() {
    const area = document.getElementById("cardarea"), g = document.getElementById("fitgrid");
    if (!area || !g) return;
    const rev = area.classList.contains("reveal");
    const W = area.clientWidth, H = area.clientHeight, tag = 24;
    const sw = rev ? Math.max(190, Math.min(320, W * 0.22)) : 0; // width of each hand panel
    const sg = rev ? Math.max(20, W * 0.03) : 0;                // space between panels and grid
    const rg = Math.max(10, Math.min(28, H * 0.03));               // row gap
    const availW = W - 2 * sw - 2 * sg;
    const ch = Math.max(60, Math.min((H - 3 * rg - 4 * tag) / 4, ((availW - 3 * 14) / 4) * 1.4));
    const cw = ch / 1.4;
    const spread = Math.max(14, Math.min(cw * 0.9, (W * 0.88 - 4 * cw) / 3)); // generous column gap while playing
    const set = (k, val) => area.style.setProperty(k, val + "px");
    set("--ch", ch); set("--cw", cw); set("--rg", rg); set("--cg", rev ? 14 : spread); set("--cgFrom", spread);
    set("--sw", sw); set("--sg", sg); set("--mch", Math.min(ch * 0.95, 150));
  }
  addEventListener("resize", fitCards);

  // countdown elements: data-end = local timestamp
  setInterval(() => {
    document.querySelectorAll("[data-end]").forEach(el => {
      const s = Math.max(0, Math.ceil((+el.dataset.end - Date.now()) / 1000));
      const t = s >= 60 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : String(s);
      if (el.textContent !== t) el.textContent = t;
    });
  }, 200);
  const timerHTML = v => v.endsIn > 0 ? '<div class="timer" data-end="' + (Date.now() + v.endsIn) + '"></div>' : "";

  /* ---------- start screen ---------- */
  function home(msg) {
    const saved = store.get("mpk-host");
    app.innerHTML = '<div class="wrap stack"><h1>Memory Poker</h1>' +
      '<p class="muted">16 Karten merken, 2 davon wählen, mit 3 Gemeinschaftskarten die beste Pokerhand bilden.</p><p class="small">Version 202611252335</p>' +
      (msg ? '<p class="err">' + esc(msg) + "</p>" : "") +
      '<div class="row"><button class="btn main big" id="goHost">Spiel hosten</button><button class="btn big" id="goJoin">Spiel beitreten</button></div>' +
      (saved && saved.phase !== "end" ? '<div class="panel row"><span>Laufendes Spiel in Raum <b>' + esc(saved.code) + '</b> gefunden.</span><button class="btn main" id="resume">Fortsetzen</button><button class="btn" id="drop">Verwerfen</button></div>' : "") +
      "</div>";
    document.getElementById("goHost").onclick = hostSettings;
    document.getElementById("goJoin").onclick = () => joinForm();
    if (saved && saved.phase !== "end") {
      document.getElementById("resume").onclick = () => new Host(saved.settings, saved);
      document.getElementById("drop").onclick = () => { store.del("mpk-host"); home(); };
    }
  }

  /* ---------- host ---------- */
  function hostSettings() {
    const s = store.get("mpk-settings") || { memo: 30, sel: 60, games: 4, showHost: false };
    const opt = (vals, cur, lab) => vals.map(x => '<option value="' + x + '"' + (x === cur ? " selected" : "") + ">" + lab(x) + "</option>").join("");
    const sec = x => x >= 60 && x % 60 === 0 ? x / 60 + " Min." : x >= 60 ? Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0") + " Min." : x + " Sek.";
    app.innerHTML = '<div class="wrap stack"><h1>Raum einstellen</h1><div class="panel stack"><div class="form">' +
      '<div><label for="memo">Merkzeit</label><select id="memo">' + opt([10, 15, 20, 30, 45, 60, 90], s.memo, sec) + "</select></div>" +
      '<div><label for="sel">Auswahlzeit</label><select id="sel">' + opt([20, 30, 45, 60, 90, 120], s.sel, sec) + "</select></div>" +
      '<div><label for="games">Spiele pro Person</label><select id="games">' + opt([2, 4, 6, 8], s.games, x => x + " Spiele") + "</select></div>" +
      '<div><label for="rep">Gleiche Gegner mehrmals?</label><select id="rep"><option value="0">Nein, jedes Duell nur einmal</option><option value="1"' + (s.repeat ? " selected" : "") + ">Ja, Wiederholungen erlaubt</option></select></div>" +
      '</div><p class="small">Gerade Anzahl Spiele, damit es bei jeder Spielerzahl aufgeht. Ohne Wiederholungen spielt niemand zweimal gegen dieselbe Person. Die Karten erscheinen nur auf diesem Bildschirm, die Handys sind nur zum Eingeben.</p>' +
      '<div class="row"><button class="btn main big" id="create">Raum erstellen</button><button class="btn" id="back">Zurück</button></div></div></div>';
    document.getElementById("back").onclick = () => home();
    document.getElementById("create").onclick = () => {
      const settings = { memo: +memoSel().value, sel: +document.getElementById("sel").value, games: +document.getElementById("games").value, repeat: document.getElementById("rep").value === "1" };
      store.set("mpk-settings", settings);
      new Host(settings, null);
    };
    const memoSel = () => document.getElementById("memo");
  }

  class Host {
    constructor(settings, saved) {
      this.s = settings;
      this.conns = new Map(); // pid -> conn
      this.timer = null;
      if (saved) Object.assign(this, { code: saved.code, players: saved.players, phase: saved.phase, matches: saved.matches, mi: saved.mi, deck: saved.deck, picks: saved.picks, result: saved.result, deadline: saved.deadline });
      else Object.assign(this, { code: newCode(), players: [], phase: "lobby", matches: [], mi: -1, deck: null, picks: null, result: null, deadline: 0 });
      this.players.forEach(p => (p.online = false));
      this.tries = 0;
      this.listen();
    }
    listen() {
      app.innerHTML = '<div class="wrap"><p class="phase">Raum wird erstellt …</p></div>';
      this.net = Net.host(this.code, () => { this.resumeTimer(); this.render(); }, c => this.onConn(c), e => {
        if (e && e.type === "unavailable-id") {
          if (this.phase === "lobby" && !this.players.length) { this.code = newCode(); this.listen(); }
          else if (this.tries++ < 15) setTimeout(() => this.listen(), 2000); // old session still registered
          else home("Raum " + this.code + " ist noch belegt. Bitte später nochmals versuchen.");
        } else if (e && e.type === "network") this.banner("Keine Verbindung zum Server. Prüfe das Internet.");
      });
    }
    banner(t) { let b = document.querySelector(".banner"); if (!b) { b = document.createElement("div"); b.className = "banner"; document.body.appendChild(b); } b.textContent = t; }
    onConn(c) {
      c.onData(m => this.onMsg(c, m));
      c.onClose(() => {
        for (const [pid, cc] of this.conns) if (cc === c) { this.conns.delete(pid); const p = this.players.find(x => x.pid === pid); if (p) p.online = false; }
        this.update();
      });
    }
    onMsg(c, m) {
      if (!m || typeof m !== "object") return;
      if (m.t === "join") {
        const name = String(m.name || "").trim().slice(0, 20);
        const pid = String(m.pid || "").slice(0, 20);
        if (!name) return c.send({ t: "err", msg: "Bitte einen Namen eingeben." });
        let p = this.players.find(x => x.pid === pid);
        if (!p) {
          const same = this.players.find(x => x.name.toLowerCase() === name.toLowerCase());
          if (same && same.online) return c.send({ t: "err", msg: "Dieser Name ist schon vergeben." });
          if (same) { p = same; p.pid = pid; }
        }
        if (!p) {
          if (this.phase !== "lobby") return c.send({ t: "err", msg: "Das Spiel läuft schon. Neue Spieler können nicht mehr beitreten." });
          p = { pid, name, ready: false, online: true, score: 0, w: 0, d: 0, l: 0, played: 0 };
          this.players.push(p);
        }
        const old = this.conns.get(p.pid);
        this.conns.set(p.pid, c);
        if (old && old !== c) old.close();
        p.online = true;
        return this.update();
      }
      const pid = [...this.conns].find(([, cc]) => cc === c)?.[0];
      const idx = this.players.findIndex(x => x.pid === pid);
      if (idx < 0) return;
      const p = this.players[idx];
      if (m.t === "ready" && this.phase === "lobby") { p.ready = !!m.on; return this.update(); }
      if (m.t === "pick" && this.phase === "select") {
        const cur = this.matches[this.mi];
        const side = idx === cur[0] ? "a" : idx === cur[1] ? "b" : null;
        if (!side || this.picks[side].lock) return;
        const clean = x => (LET.includes(String(x || "").toUpperCase()) ? String(x).toUpperCase() : "");
        this.picks[side].l1 = clean(m.l1);
        this.picks[side].l2 = clean(m.l2);
        if (m.lock && this.valid(this.picks[side])) this.picks[side].lock = true;
        if (this.picks.a.lock && this.picks.b.lock) return this.reveal();
        return this.update();
      }
    }
    valid(pk) { return pk.l1 && pk.l2 && pk.l1 !== pk.l2; }
    effGames() { return P.effectiveGames(this.players.length, this.s.games, this.s.repeat); }
    start() {
      if (this.players.length < 2) return;
      this.matches = P.makeSchedule(this.players.length, this.s.games, this.s.repeat);
      this.mi = -1;
      this.next();
    }
    setPhase(ph, secs, then) {
      clearTimeout(this.timer);
      this.phase = ph;
      this.deadline = secs ? Date.now() + secs * 1000 : 0;
      if (secs) this.timer = setTimeout(then, secs * 1000);
      this.update();
    }
    resumeTimer() {
      const left = this.deadline - Date.now();
      const map = { intro: () => this.memo(), memo: () => this.select(), select: () => this.reveal() };
      if (map[this.phase]) { clearTimeout(this.timer); this.timer = setTimeout(map[this.phase], Math.max(0, left)); }
    }
    next() {
      this.mi++;
      if (this.mi >= this.matches.length) return this.setPhase("end", 0);
      this.result = null;
      this.setPhase("intro", 5, () => this.memo());
    }
    memo() {
      this.deck = P.newDeck(19);
      this.picks = { a: { l1: "", l2: "", lock: false }, b: { l1: "", l2: "", lock: false } };
      this.setPhase("memo", this.s.memo, () => this.select());
    }
    select() { this.setPhase("select", this.s.sel, () => this.reveal()); }
    reveal() {
      if (this.phase !== "select") return;
      const [ia, ib] = this.matches[this.mi];
      const comm = this.deck.slice(16, 19);
      const hand = pk => this.valid(pk) ? P.evalHand([this.deck[LET.indexOf(pk.l1)], this.deck[LET.indexOf(pk.l2)], ...comm]) : null;
      const ha = hand(this.picks.a), hb = hand(this.picks.b);
      let winner;
      if (ha && hb) { const c = P.cmp(ha, hb); winner = c > 0 ? "A" : c < 0 ? "B" : "draw"; }
      else winner = ha ? "A" : hb ? "B" : "none";
      const A = this.players[ia], B = this.players[ib];
      A.played++; B.played++;
      if (winner === "A") { A.score += 1; A.w++; B.l++; }
      else if (winner === "B") { B.score += 1; B.w++; A.l++; }
      else if (winner === "draw") { A.score += 0.5; B.score += 0.5; A.d++; B.d++; }
      else { A.l++; B.l++; }
      this.result = { winner, validA: !!ha, validB: !!hb, da: ha ? P.describe(ha) : "", db: hb ? P.describe(hb) : "" };
      this.setPhase("reveal", 0);
    }
    postpone() {
      // move the current match to the end (e.g. a player is away) and continue
      const m = this.matches.splice(this.mi, 1)[0];
      this.matches.push(m);
      this.mi--;
      this.next();
    }
    viewFor(who) {
      const cur = this.matches[this.mi] || [];
      const role = who === "host" ? "host" : who === cur[0] ? "A" : who === cur[1] ? "B" : "spectator";
      const playing = role === "A" || role === "B";
      const v = {
        phase: this.phase, role, code: this.code, me: who, no: this.mi + 1, total: this.matches.length,
        a: cur[0], b: cur[1], endsIn: this.deadline ? this.deadline - Date.now() : 0, settings: this.s, games: this.effGames(),
        players: this.players.map(p => ({ name: p.name, score: p.score, w: p.w, d: p.d, l: p.l, played: p.played, ready: p.ready, online: p.online }))
      };
      // cards only ever go to the host screen; phones get the input and the result
      if (role === "host" && this.phase === "memo") v.cards = this.deck.slice(0, 16);
      if (role === "host" && (this.phase === "select" || this.phase === "reveal")) v.comm = this.deck.slice(16, 19);
      if (this.phase === "select") {
        v.locks = { a: this.picks.a.lock, b: this.picks.b.lock };
        if (playing) v.mine = this.picks[role === "A" ? "a" : "b"];
      }
      if (this.phase === "reveal") {
        if (role === "host") v.cards = this.deck.slice(0, 16);
        const L = pk => (this.valid(pk) ? [pk.l1, pk.l2] : []);
        v.picks = { a: { letters: L(this.picks.a) }, b: { letters: L(this.picks.b) } };
        v.result = this.result;
      }
      if (role === "host") v.matches = this.matches;
      const nx = this.matches[this.mi + 1];
      if (nx) v.next = nx;
      return v;
    }
    update() {
      this.players.forEach((p, i) => { const c = this.conns.get(p.pid); if (c) c.send({ t: "view", v: this.viewFor(i) }); });
      store.set("mpk-host", { settings: this.s, code: this.code, players: this.players, phase: this.phase, matches: this.matches, mi: this.mi, deck: this.deck, picks: this.picks, result: this.result, deadline: this.deadline });
      this.render();
    }
    render() {
      const v = this.viewFor("host");
      const name = i => esc(this.players[i]?.name || "?");
      if (this.phase === "lobby") {
        const url = location.origin + location.pathname + "?room=" + this.code + (LOCAL ? "&local" : "");
        const n = this.players.length, g = P.effectiveGames(n, this.s.games, this.s.repeat);
        const allReady = n >= 2 && this.players.every(p => p.ready);
        app.innerHTML = '<div class="wrap stack"><div class="hero"><div><p class="muted">Raumcode</p><div class="code">' + this.code + '</div><p class="small">Beitreten auf dieser Seite mit «Spiel beitreten» oder direkt über den Link:</p><p class="small" style="overflow-wrap:anywhere">' + esc(url) + "</p></div>" +
          '<div class="qr" id="qr" aria-label="QR-Code zum Beitreten"></div></div>' +
          '<div class="panel stack"><h2>Spieler (' + n + ")</h2>" +
          (n ? '<ul class="plist">' + this.players.map(p => '<li class="' + (p.ready ? "ready" : "") + (p.online ? "" : " off") + '"><span>' + esc(p.name) + "</span>" + (p.online ? (p.ready ? '<span class="st-ok">bereit</span>' : '<span class="st-wait">wartet</span>') : '<span class="st-wait">offline</span>') + "</li>").join("") + "</ul>" : '<p class="muted">Noch niemand da.</p>') +
          '<p class="small">Merkzeit ' + this.s.memo + " Sek. · Auswahlzeit " + this.s.sel + " Sek. · " + (n >= 2 ? g + " Spiele pro Person, total " + (n * g) / 2 + " Spiele" + (g < this.s.games ? " (bei " + n + " Personen geht nicht mehr)" : "") : this.s.games + " Spiele pro Person") + "</p>" +
          '<div class="row"><button class="btn main big" id="start"' + (allReady ? "" : " disabled") + ">Start</button></div>" +
          '<p class="small">' + (n < 2 ? "Mindestens 2 Spieler nötig." : allReady ? "Alle bereit." : "Start geht, sobald alle auf «Bereit» gedrückt haben.") + "</p></div></div>";
        document.getElementById("start").onclick = () => this.start();
        if (window.qrcode) { try { const q = qrcode(0, "M"); q.addData(url); q.make(); document.getElementById("qr").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0 }); } catch (e) {} }
        return;
      }
      if (this.phase === "end") {
        app.innerHTML = '<div class="wrap stack"><h1>Rangliste</h1><div class="panel">' + boardHTML(v.players, -1) + '</div><div class="row"><button class="btn" id="home">Neues Spiel</button></div></div>';
        document.getElementById("home").onclick = () => { store.del("mpk-host"); this.net.destroy(); home(); };
        return;
      }
      const titles = { intro: "Gleich geht’s los", memo: "Karten merken", select: "Auswahl läuft", reveal: "Auflösung" };
      let center = "";
      if (this.phase === "select") center = '<p class="small" style="text-align:center">' + name(v.a) + ": " + (v.locks.a ? "bereit" : "wählt …") + " · " + name(v.b) + ": " + (v.locks.b ? "bereit" : "wählt …") + "</p>";
      if (this.phase === "reveal") center = resultHTML(v);
      const btns = {
        intro: '<button class="btn main" id="skip">Sofort starten</button><button class="btn" id="post">Spiel verschieben</button>',
        memo: '<button class="btn main" id="skip">Merkzeit beenden</button>',
        select: '<button class="btn main" id="skip">Auswahl beenden</button>',
        reveal: '<button class="btn main" id="nx">' + (this.mi + 1 < this.matches.length ? "Nächstes Spiel" : "Zur Rangliste") + "</button>"
      }[this.phase];
      const rev = this.phase === "reveal";
      const picked = {};
      if (v.picks) { v.picks.a.letters.forEach(l => (picked[l] = (picked[l] || "") + " pa")); v.picks.b.letters.forEach(l => (picked[l] = (picked[l] || "") + " pb")); }
      const cls = l => rev ? (picked[l] ? picked[l] + " picked" : " dim") : "";
      const grid = this.phase === "intro"
        ? '<div class="nextup"><p class="muted">Als Nächstes</p><p class="vsline big"><span class="a">' + name(v.a) + '</span> gegen <span class="b">' + name(v.b) + "</span></p></div>"
        : '<div class="grid fit" id="fitgrid">' + LET.map((l, i) => '<div class="slot"><span class="tag">' + l + "</span>" + cardHTML(v.cards ? v.cards[i] : null, { down: !v.cards, label: l, cls: cls(l) }) + "</div>").join("") + "</div>";
      const comm = (v.comm || [null, null, null]).map(c => cardHTML(c, { down: !c, label: "?" })).join("");
      const handSide = side => {
        const r = v.result, pi = side === "a" ? v.a : v.b, letters = v.picks[side].letters;
        const valid = side === "a" ? r.validA : r.validB, desc = side === "a" ? r.da : r.db;
        const won = r.winner === (side === "a" ? "A" : "B");
        const badge = won ? '<span class="badge">Sieg · 1 Punkt</span>' : r.winner === "draw" ? '<span class="badge d">Unentschieden · 0,5</span>' : '<span class="badge l">0 Punkte</span>';
        const minis = valid ? letters.map(l => '<div class="slot"><span class="tag">' + l + "</span>" + cardHTML(v.cards[LET.indexOf(l)], {}) + "</div>").join("") : '<p class="muted">keine gültige Auswahl</p>';
        return '<div class="hand2 ' + side + (won ? " won" : "") + '"><div class="who">' + name(pi) + '</div><div class="mini">' + minis + '</div><div class="hdesc">' + esc(desc || "") + "</div>" + badge + "</div>";
      };
      let top = "";
      if (this.phase === "select") top = '<p class="hstatus"><span class="a">' + name(v.a) + "</span> " + (v.locks.a ? "✓ bereit" : "wählt …") + ' · <span class="b">' + name(v.b) + "</span> " + (v.locks.b ? "✓ bereit" : "wählt …") + "</p>";
      if (rev) {
        const r = v.result;
        top = '<p class="winline">' + (r.winner === "A" ? name(v.a) + " gewinnt!" : r.winner === "B" ? name(v.b) + " gewinnt!" : r.winner === "draw" ? "Unentschieden!" : "Keine gültige Auswahl") + "</p>";
      }
      app.innerHTML = '<div class="hostgame">' +
        '<header class="hbar"><p class="hphase">Spiel ' + v.no + " von " + v.total + " · " + titles[this.phase] + '</p>' +
        '<p class="vsline"><span class="a">' + name(v.a) + '</span> gegen <span class="b">' + name(v.b) + "</span></p>" +
        '<div class="htimer">' + timerHTML(v) + "</div>" +
        '<div class="row">' + btns + "</div></header>" +
        '<aside class="hleft"><div class="hcomm"><span class="small">Gemeinschaftskarten</span>' + comm + '</div><p class="small">Raumcode ' + this.code + "</p></aside>" +
        '<section class="felt hmain">' + (top ? '<div class="hres">' + top + "</div>" : "") +
        '<div class="cardarea' + (rev ? " reveal" : "") + '" id="cardarea">' + (rev ? handSide("a") : "") + grid + (rev ? handSide("b") : "") + "</div></section></div>";
      fitCards(); requestAnimationFrame(fitCards); if (document.fonts) document.fonts.ready.then(fitCards);
      const on = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
      on("skip", () => ({ intro: () => this.memo(), memo: () => this.select(), select: () => this.reveal() }[this.phase]()));
      on("post", () => this.postpone());
      on("nx", () => this.next());
    }
  }

  /* ---------- player ---------- */
  function joinForm(msg, code) {
    const saved = store.get("mpk-player") || {};
    const c = code || params.get("room") || saved.code || "";
    app.innerHTML = '<div class="wrap stack"><h1>Spiel beitreten</h1><div class="panel stack">' +
      '<div class="form"><div><label for="code">Raumcode</label><input type="text" class="code-in" id="code" maxlength="4" autocomplete="off" value="' + esc(c) + '"></div>' +
      '<div><label for="name">Dein Name</label><input type="text" id="name" maxlength="20" autocomplete="off" value="' + esc(saved.name || "") + '"></div></div>' +
      '<p class="err" id="err">' + esc(msg || "") + '</p><div class="row"><button class="btn main big" id="join">Beitreten</button><button class="btn" id="back">Zurück</button></div></div></div>';
    document.getElementById("back").onclick = () => home();
    const go = () => {
      const code = document.getElementById("code").value.trim().toUpperCase();
      const name = document.getElementById("name").value.trim();
      if (code.length !== 4) return (document.getElementById("err").textContent = "Der Raumcode hat 4 Buchstaben.");
      if (!name) return (document.getElementById("err").textContent = "Bitte deinen Namen eingeben.");
      const pid = saved.code === code && saved.pid && saved.name === name ? saved.pid : rid();
      store.set("mpk-player", { code, name, pid });
      new Player(code, name, pid);
    };
    document.getElementById("join").onclick = go;
    app.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => { if (e.key === "Enter") go(); }));
  }

  class Player {
    constructor(code, name, pid) {
      Object.assign(this, { code, name, pid, v: null, key: "", sel: ["", ""], connected: false, retries: 0 });
      app.innerHTML = '<div class="wrap"><p class="phase">Verbinde mit Raum ' + esc(code) + " …</p></div>";
      this.connect();
    }
    connect() {
      this.net = Net.join(this.code, c => {
        this.conn = c; this.connected = true; this.retries = 0;
        document.querySelector(".banner")?.remove();
        c.onData(m => this.onMsg(m));
        c.onClose(() => this.lost());
        c.send({ t: "join", name: this.name, pid: this.pid });
      }, e => {
        if (!this.v && e && e.type === "peer-unavailable") return joinForm("Raum " + this.code + " nicht gefunden. Code prüfen.", this.code);
        this.lost();
      });
    }
    lost() {
      if (this.stopped || (!this.connected && this.retrying)) return;
      this.connected = false;
      if (this.v) { let b = document.querySelector(".banner"); if (!b) { b = document.createElement("div"); b.className = "banner"; document.body.appendChild(b); } b.textContent = "Verbindung unterbrochen, verbinde neu …"; }
      this.retrying = true;
      setTimeout(() => { this.retrying = false; try { this.net.destroy(); } catch (e) {} this.connect(); }, 2500);
    }
    onMsg(m) {
      if (m.t === "err") { this.stopped = true; this.net.destroy(); return joinForm(m.msg, this.code); }
      if (m.t === "view") { this.v = m.v; this.render(); }
    }
    sendPick(lock) { this.conn?.send({ t: "pick", l1: this.sel[0], l2: this.sel[1], lock: !!lock }); }
    render() {
      const v = this.v, me = v.me, P_ = v.players, my = P_[me];
      const key = v.phase + ":" + v.no;
      const fresh = key !== this.key;
      this.key = key;
      const name = i => esc(P_[i]?.name || "?");
      const playing = v.role === "A" || v.role === "B";
      if (v.phase === "lobby") {
        app.innerHTML = '<div class="wrap stack"><h1>Hallo ' + esc(my.name) + '</h1><div class="panel stack"><p>Raum <b>' + esc(v.code) + "</b> · " + P_.length + " Spieler</p>" +
          '<ul class="plist">' + P_.map((p, i) => '<li class="' + (p.ready ? "ready" : "") + '"><span>' + esc(p.name) + (i === me ? " (du)" : "") + "</span>" + (p.ready ? '<span class="st-ok">bereit</span>' : '<span class="st-wait">wartet</span>') + "</li>").join("") + "</ul>" +
          (my.ready ? '<p class="phase">Warte auf den Host …</p><button class="btn" id="unready">Doch nicht bereit</button>' : '<button class="btn main big" id="ready">Bereit</button>') +
          '<p class="small">Merkzeit ' + v.settings.memo + " Sek. · Auswahlzeit " + v.settings.sel + " Sek. · " + v.games + " Spiele pro Person</p></div></div>";
        const r = document.getElementById("ready"), u = document.getElementById("unready");
        if (r) r.onclick = () => this.conn.send({ t: "ready", on: true });
        if (u) u.onclick = () => this.conn.send({ t: "ready", on: false });
        return;
      }
      if (v.phase === "end") {
        app.innerHTML = '<div class="wrap stack"><h1>Rangliste</h1><div class="panel">' + boardHTML(P_, me) + "</div></div>";
        return;
      }
      if (v.phase === "select" && playing && !fresh) return this.updateSelect();
      if (v.phase === "select" && playing && fresh) { this.sel = [v.mine.l1 || "", v.mine.l2 || ""]; }
      const vs = '<p class="vsline"><span class="a">' + name(v.a) + '</span> gegen <span class="b">' + name(v.b) + "</span></p>";
      const myPts = '<p class="small" style="text-align:center">Deine Punkte: ' + fmt(my.score) + " · Spiele: " + my.played + " / " + v.games + "</p>";
      let body = "";
      if (v.phase === "intro") body = '<p class="phase">' + (playing ? "Du bist dran!" : "Nächstes Spiel") + "</p>" + vs + timerHTML(v) + '<p class="msg">' + (playing ? "Schau gleich auf den grossen Bildschirm und merk dir die 16 Karten." : "Du schaust zu.") + "</p>";
      if (v.phase === "memo") body = '<p class="phase">' + (playing ? "Karten merken!" : "Merkphase") + "</p>" + vs + timerHTML(v) + '<p class="msg">' + (playing ? "Die Karten sind auf dem grossen Bildschirm." : "Die beiden merken sich die Karten.") + "</p>";
      if (v.phase === "select" && !playing) body = '<p class="phase">Auswahl läuft</p>' + vs + timerHTML(v) + '<p class="msg">' + name(v.a) + ": " + (v.locks.a ? "bereit" : "wählt …") + "<br>" + name(v.b) + ": " + (v.locks.b ? "bereit" : "wählt …") + "</p>";
      if (v.phase === "select" && playing) body = '<p class="phase">Wähle 2 Karten</p>' + timerHTML(v) +
        '<div class="picks"><div><label for="p1">1. Karte</label><input class="pick" id="p1" maxlength="1" autocomplete="off" autocapitalize="characters" value="' + esc(this.sel[0]) + '"></div><div><label for="p2">2. Karte</label><input class="pick" id="p2" maxlength="1" autocomplete="off" autocapitalize="characters" value="' + esc(this.sel[1]) + '"></div></div>' +
        '<div class="keys">' + LET.map(l => '<button type="button" class="key" data-l="' + l + '">' + l + "</button>").join("") + "</div>" +
        '<button class="btn main big" id="lock">Bereit</button><p class="err" id="perr" style="text-align:center"></p><p class="small" id="pstate" style="text-align:center"></p>';
      if (v.phase === "reveal") body = '<p class="phase">Auflösung</p>' + resultHTML(v) + '<p class="msg">Alle Karten siehst du auf dem grossen Bildschirm.</p>';
      app.innerHTML = '<div class="phone">' + body + myPts + "</div>";
      if (v.phase === "select" && playing) this.bindSelect();
    }
    bindSelect() {
      const p1 = document.getElementById("p1"), p2 = document.getElementById("p2");
      const sync = () => {
        this.sel = [p1.value.toUpperCase().trim(), p2.value.toUpperCase().trim()];
        p1.value = this.sel[0]; p2.value = this.sel[1];
        this.sendPick(false);
        this.updateSelect();
      };
      p1.addEventListener("input", () => { sync(); if (p1.value) p2.focus(); });
      p2.addEventListener("input", sync);
      app.querySelectorAll("button.key[data-l]").forEach(b => b.addEventListener("click", () => {
        if (this.v.mine.lock) return;
        const l = b.dataset.l;
        if (this.sel.includes(l)) this.sel = this.sel.map(x => (x === l ? "" : x));
        else if (!this.sel[0]) this.sel[0] = l;
        else if (!this.sel[1]) this.sel[1] = l;
        else this.sel[1] = l;
        p1.value = this.sel[0]; p2.value = this.sel[1];
        this.sendPick(false);
        this.updateSelect();
      }));
      document.getElementById("lock").onclick = () => { if (this.check() === "") this.sendPick(true); };
      this.updateSelect();
    }
    check() {
      const [a, b] = this.sel;
      if (!a || !b) return "Bitte 2 Buchstaben wählen.";
      if (!LET.includes(a) || !LET.includes(b)) return "Nur Buchstaben von A bis P.";
      if (a === b) return "Jeder Buchstabe darf nur einmal vorkommen.";
      return "";
    }
    updateSelect() {
      const v = this.v, locked = v.mine.lock;
      const err = this.check();
      const p1 = document.getElementById("p1"), p2 = document.getElementById("p2"), lock = document.getElementById("lock");
      if (!p1) return;
      [p1, p2].forEach((el, i) => { el.disabled = locked; el.classList.toggle("bad", !!el.value && (!LET.includes(el.value) || (i === 1 && el.value === p1.value))); });
      lock.disabled = locked || !!err;
      lock.textContent = locked ? "Gesperrt" : "Bereit";
      document.getElementById("perr").textContent = this.sel[0] || this.sel[1] ? err : "";
      const other = v.role === "A" ? v.locks.b : v.locks.a;
      document.getElementById("pstate").textContent = locked ? (other ? "Beide bereit!" : "Gespeichert. Warte auf die andere Person …") : "Was beim Ablauf der Zeit eingetragen ist, zählt auch ohne «Bereit»." + (other ? " Die andere Person ist schon bereit." : "");
      app.querySelectorAll("button.key[data-l]").forEach(b => { b.classList.toggle("sel", this.sel.includes(b.dataset.l)); b.disabled = locked; });
      const t = app.querySelector("[data-end]");
      if (t && v.endsIn > 0) t.dataset.end = Date.now() + v.endsIn;
    }
  }

  if (params.get("room")) joinForm(); else home();
})();
