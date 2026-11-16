/* ki.js — 自動游玩 AI（AUTO PLAY）。
 * 掛 "bild" 鉤子，僅於 Spiel.zustand==="spiel" 且 Held.lebt 時覆寫 Eingabe。
 * 策略：威脅近距離撤退／中距離周旋／遠距離逼近；血量低時優先拾取補給；
 * 無威脅時搜尋補給或巡遊。目標選擇沿用遊戲自動瞄準（zielAktiv=false）。 */
const KI = {
  an: !1,
  wx: 0, wy: 0, wt: 0,
  aktT: 0,
  hud: null
};

function KI_an() { return KI.an; }
function KI_umschalten() { KI_setze(!KI.an); }
function KI_setze(v) {
  KI.an = !!v;
  try { Speicher_schreib("ki", KI.an ? "1" : "0"); } catch (e) {}
  KI_bauHud();
  KI_hudZeige();
  if (!KI.an) KI_frei();
}

!function () {
  try { KI.an = Speicher_lies("ki", "0") === "1"; } catch (e) { KI.an = !1; }
}();

function KI_frei() {
  Eingabe.x = 0; Eingabe.y = 0;
  Eingabe.rennen = !1; Eingabe.schleichen = !1;
  Eingabe.buendel = !1; Eingabe.buendelMaus = !1; Eingabe.buendelTouch = !1;
  Eingabe.zielAktiv = !1; Eingabe.halten = !1;
}

function KI_feinde() {
  const out = [];
  if ("function" != typeof Wesen_liste || "undefined" == typeof Held) return out;
  for (const w of Wesen_liste()) {
    if (!w || w.tot) continue;
    if ("function" == typeof Waffen_ziel && !Waffen_ziel(w)) continue;
    if (!W_sichtlinie(Held.x, Held.y - 4, w.x, w.y - 4, 2)) continue;
    out.push({ w, d: W_abstand(Held.x, Held.y, w.x, w.y), dx: W_dx(Held.x, w.x), dy: W_dy(Held.y, w.y) });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

const KI_SAMMEL = { mandelwasser: 1, batterie: 1, waffe: 1, feuerwaffe: 1, klebeband: 1, erstehilfe: 1 };
function KI_gueter() {
  const out = [];
  if ("function" != typeof Dinge_alle || "undefined" == typeof Held) return out;
  for (const g of Dinge_alle()) {
    if (!g || !KI_SAMMEL[g.art]) continue;
    out.push({ g, d: W_abstand(Held.x, Held.y, g.x, g.y), dx: W_dx(Held.x, g.x), dy: W_dy(Held.y, g.y) });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

function KI_freiWeg(dx, dy) {
  const n = Math.hypot(dx, dy) || 1;
  dx /= n; dy /= n;
  const r = (Held.r || 5) * 1.7;
  if (W_frei(Held.x + dx * r, Held.y + dy * r, Held.r || 5)) return { x: dx, y: dy };
  const ps = [{ x: -dy, y: dx }, { x: dy, y: -dx }, { x: -dx, y: -dy }];
  for (const p of ps) {
    if (W_frei(Held.x + p.x * r, Held.y + p.y * r, Held.r || 5)) return p;
  }
  return { x: 0, y: 0 };
}

function KI_herzen() { return "undefined" != typeof Kampf ? Kampf.herzen : 3; }
function KI_akku() { return "undefined" != typeof Kampf ? Kampf.akku : 1; }

function KI_bauHud() {
  if (KI.hud || "undefined" == typeof document || !document.body) return;
  KI_css();
  const el = UI_el("div", "kiHud", "", UI_wurzel());
  el.setAttribute("aria-hidden", "true");
  el.textContent = "AI";
  KI.hud = el;
}
function KI_hudZeige() { if (KI.hud) KI.hud.style.display = KI.an ? "" : "none"; }
function KI_css() {
  if (document.getElementById("kiCss")) return;
  const t = document.createElement("style");
  t.id = "kiCss";
  t.textContent = "#kiHud{position:fixed;top:8px;right:8px;z-index:30;padding:2px 8px;border:1px solid rgba(201,184,132,.5);background:rgba(12,10,4,.6);color:#e9db95;font:700 12px/1.2 var(--ui-mono,monospace);letter-spacing:.18em;text-shadow:0 0 6px rgba(234,219,149,.6);pointer-events:none}";
  document.head.appendChild(t);
}

Spiel_haken("levelStart", function () { KI.wx = Held ? Held.x : 0; KI.wy = Held ? Held.y : 0; KI.wt = 0; KI.aktT = 0; });

Spiel_haken("bild", function () {
  if ("undefined" == typeof document) return;
  KI_bauHud();
  KI_hudZeige();
  if (!KI.an) return;
  if ("spiel" !== Spiel.zustand || "undefined" == typeof Held || !Held.lebt) return;
  if ("function" == typeof Menue_offen && Menue_offen()) return;
  if (Held.imAuto) return;

  const feinde = KI_feinde();
  const lowHp = KI_herzen() <= 1;
  const akkuLow = KI_akku() <= .25;

  let mx = 0, my = 0, rennen = !1, feuern = !1, aktion = !1;

  if (feinde.length) {
    const f = feinde[0], d = f.d;
    const close = 26, hold = 64;
    if (lowHp) {
      const g = KI_gueter().find(o => o.g.art === "erstehilfe" || o.g.art === "mandelwasser");
      if (g && g.d < 120) { mx = g.dx; my = g.dy; rennen = !0; }
      else { mx = -f.dx; my = -f.dy; rennen = !0; }
    } else if (d < close) {
      mx = -f.dx; my = -f.dy; rennen = !0;
      if ("undefined" != typeof Kampf && Kampf.waffe) aktion = !0;
    } else if (d < hold) {
      mx = -f.dy; my = f.dx;   // 橫向周旋
      feuern = !0;
    } else {
      mx = f.dx; my = f.dy; rennen = !0; feuern = !0;
    }
  } else {
    const gueter = KI_gueter();
    let target = null;
    if (lowHp) target = gueter.find(o => o.g.art === "erstehilfe" || o.g.art === "mandelwasser");
    if (!target && akkuLow) target = gueter.find(o => o.g.art === "batterie");
    if (!target) target = gueter[0];
    if (target && target.d < 140) { mx = target.dx; my = target.dy; }
    else {
      KI.wt -= 1 / 30;
      if (KI.wt <= 0 || !W_frei(KI.wx, KI.wy, 6)) {
        KI.wx = Held.x + (Math.random() * 2 - 1) * 120;
        KI.wy = Held.y + (Math.random() * 2 - 1) * 120;
        KI.wt = 4 + Math.random() * 4;
      }
      mx = W_dx(Held.x, KI.wx); my = W_dy(Held.y, KI.wy);
    }
  }

  const n = Math.hypot(mx, my);
  if (n > .1) {
    const weg = KI_freiWeg(mx, my);
    mx = weg.x; my = weg.y;
  } else { mx = 0; my = 0; }

  Eingabe.x = klemm(mx, -1, 1);
  Eingabe.y = klemm(my, -1, 1);
  Eingabe.rennen = rennen && Math.hypot(mx, my) > .2 && !Held.erschoepft;
  Eingabe.schleichen = !1;
  Eingabe.zielAktiv = !1;
  Eingabe.buendelMaus = feuern;
  Eingabe.buendel = !1; Eingabe.buendelTouch = !1;

  if (aktion) {
    if (KI.aktT <= 0) { Eingabe.aktion++; Eingabe.halten = !0; KI.aktT = .35; }
  } else {
    Eingabe.halten = !1;
  }
  KI.aktT = Math.max(0, KI.aktT - 1 / 30);
});
