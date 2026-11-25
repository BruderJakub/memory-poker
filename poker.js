// Poker evaluation, deck and match schedule. Pure functions, shared by host and players.
(function (root) {
  const SUITS = ["♠", "♥", "♦", "♣"];
  const RN = { 11: "J", 12: "Q", 13: "K", 14: "A" };
  const RNAME = { 11: "Buben", 12: "Damen", 13: "Könige", 14: "Asse" };
  const HN = ["Höchste Karte", "Paar", "Zwei Paare", "Drilling", "Strasse", "Flush", "Full House", "Vierling", "Straight Flush"];

  function newDeck(n) {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
    shuffle(d);
    return d.slice(0, n);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Returns a comparable array: [category, tiebreakers...]
  function evalHand(cs) {
    const rs = cs.map(c => c.r).sort((a, b) => b - a);
    const flush = cs.every(c => c.s === cs[0].s);
    const uniq = [...new Set(rs)];
    let sh = 0;
    if (uniq.length === 5) {
      if (rs[0] - rs[4] === 4) sh = rs[0];
      else if (rs.join() === "14,5,4,3,2") sh = 5;
    }
    const cnt = {};
    rs.forEach(r => (cnt[r] = (cnt[r] || 0) + 1));
    const g = Object.entries(cnt).map(([r, c]) => [c, +r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const byG = g.map(x => x[1]);
    if (sh && flush) return [8, sh];
    if (g[0][0] === 4) return [7, ...byG];
    if (g[0][0] === 3 && g[1][0] === 2) return [6, ...byG];
    if (flush) return [5, ...rs];
    if (sh) return [4, sh];
    if (g[0][0] === 3) return [3, ...byG];
    if (g[0][0] === 2 && g[1][0] === 2) return [2, ...byG];
    if (g[0][0] === 2) return [1, ...byG];
    return [0, ...rs];
  }

  function cmp(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  const rn = r => RN[r] || String(r);
  const rname = r => RNAME[r] || r + "er";

  function describe(v) {
    if (v[0] === 8 && v[1] === 14) return "Royal Flush";
    if (v[0] === 1) return "Paar " + rname(v[1]);
    if (v[0] === 2) return "Zwei Paare, " + rname(v[1]) + " und " + rname(v[2]);
    if (v[0] === 3) return "Drilling " + rname(v[1]);
    if (v[0] === 7) return "Vierling " + rname(v[1]);
    if (v[0] === 6) return "Full House, " + rname(v[1]) + " auf " + rname(v[2]);
    if (v[0] === 4 || v[0] === 8) return HN[v[0]] + " bis " + rn(v[1]);
    return HN[v[0]] + " (" + rn(v[1]) + ")";
  }

  // Largest valid number of games per player: at most n-1, and n*k must be even.
  function effectiveGames(n, k) {
    let e = Math.min(k, n - 1);
    if ((n * e) % 2) e--;
    return Math.max(e, 0);
  }

  // Every player plays exactly k games, never the same opponent twice (circulant graph),
  // ordered so nobody plays twice in a row when it can be avoided.
  function makeSchedule(n, k) {
    k = effectiveGames(n, k);
    const order = shuffle([...Array(n).keys()]);
    const edges = [];
    for (let d = 1; d <= Math.floor(k / 2); d++)
      for (let i = 0; i < n; i++) edges.push([order[i], order[(i + d) % n]]);
    if (k % 2) for (let i = 0; i < n / 2; i++) edges.push([order[i], order[i + n / 2]]);
    const last = Array(n).fill(-99);
    const out = [];
    const pool = shuffle(edges.slice());
    while (pool.length) {
      let best = 0, bestScore = -Infinity;
      pool.forEach((e, i) => {
        const rest = Math.min(out.length - last[e[0]], out.length - last[e[1]]);
        const score = rest * 100 + Math.random();
        if (score > bestScore) { bestScore = score; best = i; }
      });
      const e = pool.splice(best, 1)[0];
      last[e[0]] = last[e[1]] = out.length;
      out.push(Math.random() < 0.5 ? e : [e[1], e[0]]);
    }
    return out;
  }

  root.Poker = { SUITS, newDeck, shuffle, evalHand, cmp, describe, rn, makeSchedule, effectiveGames };
})(typeof window !== "undefined" ? window : globalThis);
