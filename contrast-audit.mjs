function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180)
  const b = C * Math.sin((h * Math.PI) / 180)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const gam = (x) => { x = Math.max(0, Math.min(1, x)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055 }
  return [gam(r), gam(g), gam(bb)]
}
function hex(h) { h = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) }
function blend(fg, a, bg) { return fg.map((c, i) => c * a + bg[i] * (1 - a)) }
function lum(c) { const f = (x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); const [r, g, b] = c.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
function cr(a, b) { const l1 = lum(a), l2 = lum(b); return ((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2) }
const white = [1, 1, 1], black = [0, 0, 0]
const lp = hex("#ffffff"), ls = hex("#f2f1ee"), dp = hex("#0b0b0c"), ds = hex("#151516")
const L = {
  t1: hex("#202022"), t2: hex("#3b3b3e"), t3: blend(black, 0.57, white), t4: blend(black, 0.47, white), t5: blend(black, 0.31, white),
  t3shell: blend(black, 0.57, ls), t4shell: blend(black, 0.47, ls),
  kbd: blend(blend(black, 0.57, white), 0.8, white), label70: blend(blend(black, 0.57, white), 0.7, white),
  destructive: oklchToRgb(0.55, 0.21, 27.3), input: blend(black, 0.43, white),
  ring40: blend(oklchToRgb(0.4, 0.006, 286), 0.4, white), edgeStrong: blend(black, 0.14, white), chart1: oklchToRgb(0.87, 0, 0),
  knockout: oklchToRgb(0.955, 0.001, 286), primary: oklchToRgb(0.19, 0.003, 286), primaryFg: oklchToRgb(0.985, 0.001, 286),
}
const D = {
  t1: hex("#ececee"), t2: hex("#d7d7da"), t3: hex("#9d9da2"), t4: hex("#83838a"), t5: hex("#67676c"),
  kbd: blend(hex("#9d9da2"), 0.8, dp), label70: blend(hex("#9d9da2"), 0.7, dp),
  destructive: oklchToRgb(0.7, 0.19, 22.2), input: blend(white, 0.34, dp),
  ring45: blend(oklchToRgb(0.75, 0.006, 286), 0.45, dp), edgeStrong: blend(white, 0.13, dp), chart1: oklchToRgb(0.87, 0, 0),
  knockout: oklchToRgb(0.185, 0.002, 286), primary: oklchToRgb(0.955, 0.001, 286), primaryFg: oklchToRgb(0.13, 0, 0),
  popover: blend(oklchToRgb(0.21, 0.003, 286), 0.84, dp),
}
console.log("LIGHT on pane: t1", cr(L.t1, lp), "t2", cr(L.t2, lp), "t3", cr(L.t3, lp), "t4", cr(L.t4, lp), "t5", cr(L.t5, lp))
console.log("LIGHT on shell: t3", cr(L.t3shell, ls), "t4", cr(L.t4shell, ls))
console.log("LIGHT kbd/80", cr(L.kbd, lp), "label/70", cr(L.label70, lp), "destructive", cr(L.destructive, lp), "input", cr(L.input, lp), "ring40", cr(L.ring40, lp), "edgeStrong", cr(L.edgeStrong, lp), "chart1", cr(L.chart1, lp), "primaryFg/primary", cr(L.primaryFg, L.primary), "knockout on input", cr(L.knockout, L.input))
console.log("DARK on pane: t1", cr(D.t1, dp), "t2", cr(D.t2, dp), "t3", cr(D.t3, dp), "t4", cr(D.t4, dp), "t5", cr(D.t5, dp))
console.log("DARK on shell: t3", cr(D.t3, ds), "t4", cr(D.t4, ds), "t5", cr(D.t5, ds))
console.log("DARK kbd/80", cr(D.kbd, dp), "label/70", cr(D.label70, dp), "destructive", cr(D.destructive, dp), "input", cr(D.input, dp), "ring45", cr(D.ring45, dp), "edgeStrong", cr(D.edgeStrong, dp), "chart1", cr(D.chart1, dp), "primaryFg/primary", cr(D.primaryFg, D.primary), "knockout on input", cr(D.knockout, D.input), "t3 on popover", cr(D.t3, D.popover))
for (const a of [0.47, 0.5, 0.52, 0.54, 0.56]) console.log("light t4 alpha", a, cr(blend(black, a, white), lp), "on shell", cr(blend(black, a, ls), ls))
for (const a of [0.31, 0.36, 0.4, 0.42]) console.log("light t5 alpha", a, cr(blend(black, a, white), lp))
for (const a of [0.55, 0.6, 0.62, 0.65]) console.log("light ring alpha", a, cr(blend(oklchToRgb(0.4, 0.006, 286), a, white), lp))
for (const a of [0.5, 0.55, 0.6]) console.log("dark ring alpha", a, cr(blend(oklchToRgb(0.75, 0.006, 286), a, dp), dp))
for (const a of [0.55, 0.6, 0.65]) console.log("light t3 alpha", a, cr(blend(black, a, white), lp), "on shell", cr(blend(black, a, ls), ls))
console.log("light destructive candidates", [0.55, 0.53, 0.5].map((l) => [l, cr(oklchToRgb(l, 0.21, 27.3), lp)].join("=")).join(" "))
console.log("dark scrim 30% vs 55% over pane lum", lum(blend(black, 0.3, dp)).toFixed(4), lum(blend(black, 0.55, dp)).toFixed(4))
console.log("dark t5 on shell", cr(D.t5, ds), "light t5 on shell", cr(blend(black, 0.31, ls), ls))
