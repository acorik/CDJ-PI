// Helpers mínimos de DOM (sin framework: menos RAM y arranque instantáneo).

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}

const textCache = new WeakMap<Node, string>();
export function setText(el: HTMLElement, t: string): void {
  if (textCache.get(el) === t) return;
  textCache.set(el, t);
  el.textContent = t;
}

export function cls(el: Element, name: string, on: boolean): void {
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

const styleCache = new WeakMap<HTMLElement, Record<string, string>>();
export function css(el: HTMLElement, prop: string, value: string): void {
  let c = styleCache.get(el);
  if (!c) { c = {}; styleCache.set(el, c); }
  if (c[prop] === value) return;
  c[prop] = value;
  el.style.setProperty(prop, value);
}

export function fmtTime(sec: number, tenths = true): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = Math.floor(s).toString().padStart(2, "0");
  return tenths ? `${m}:${ss}.${Math.floor((s % 1) * 10)}` : `${m}:${ss}`;
}

/** Botón que distingue pulsar/soltar (para CUE, hot cues, rolls...). */
export function holdButton(label: string, className: string, down: (e: PointerEvent) => void, up?: (e: PointerEvent) => void, title?: string): HTMLButtonElement {
  const b = h("button", { class: className, title });
  b.textContent = label;
  b.addEventListener("pointerdown", (e) => { b.setPointerCapture(e.pointerId); down(e); });
  if (up) {
    b.addEventListener("pointerup", (e) => up(e));
    b.addEventListener("pointercancel", (e) => up(e));
  }
  return b;
}

/** Knob rotatorio (arrastre vertical, doble clic = valor por defecto). */
export class Knob {
  readonly el: HTMLDivElement;
  private arc: SVGPathElement;
  private dot: SVGCircleElement;
  private value = -1;
  constructor(label: string, private onChange: (v: number) => void, private def = 0.5, private bipolar = true) {
    this.el = h("div", { class: "knob", title: label });
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 40 40");
    const bg = document.createElementNS(ns, "path");
    bg.setAttribute("d", describeArc(20, 20, 15, -135, 135));
    bg.setAttribute("class", "knob-bg");
    this.arc = document.createElementNS(ns, "path");
    this.arc.setAttribute("class", "knob-arc");
    this.dot = document.createElementNS(ns, "circle");
    this.dot.setAttribute("r", "2.6");
    this.dot.setAttribute("class", "knob-dot");
    svg.append(bg, this.arc, this.dot);
    this.el.append(svg, h("span", {}, label));
    let startY = 0, startV = 0;
    const move = (e: PointerEvent) => {
      const dv = (startY - e.clientY) / (e.shiftKey ? 600 : 150);
      this.onChange(Math.max(0, Math.min(1, startV + dv)));
    };
    this.el.addEventListener("pointerdown", (e) => {
      startY = e.clientY; startV = this.value;
      this.el.setPointerCapture(e.pointerId);
      this.el.addEventListener("pointermove", move);
    });
    this.el.addEventListener("pointerup", () => this.el.removeEventListener("pointermove", move));
    this.el.addEventListener("dblclick", () => this.onChange(this.def));
    this.el.addEventListener("wheel", (e) => { e.preventDefault(); this.onChange(Math.max(0, Math.min(1, this.value - Math.sign(e.deltaY) * 0.03))); }, { passive: false });
  }
  set(v: number): void {
    if (Math.abs(v - this.value) < 0.002) return;
    this.value = v;
    const a = -135 + v * 270;
    const from = this.bipolar ? 0 : -135;
    this.arc.setAttribute("d", Math.abs(a - from) < 0.5 ? "" : describeArc(20, 20, 15, Math.min(from, a), Math.max(from, a)));
    const r = ((a - 90) * Math.PI) / 180;
    this.dot.setAttribute("cx", String(20 + 10 * Math.cos(r)));
    this.dot.setAttribute("cy", String(20 + 10 * Math.sin(r)));
  }
}

function describeArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => { const t = ((a - 90) * Math.PI) / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** Canvas que se adapta al tamaño CSS y al devicePixelRatio. */
export function fitCanvas(c: HTMLCanvasElement): { w: number; h: number; dpr: number; changed: boolean } {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const hh = Math.max(1, Math.round(c.clientHeight * dpr));
  const changed = c.width !== w || c.height !== hh;
  if (changed) { c.width = w; c.height = hh; }
  return { w, h: hh, dpr, changed };
}
