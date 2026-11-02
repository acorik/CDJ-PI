// Lector de etiquetas mínimo (sin dependencias): ID3v2.2/2.3/2.4 + ID3v1,
// FLAC (Vorbis comments) y MP4/M4A (átomos ilst). Solo lee los primeros
// cientos de KB del archivo (y el final para ID3v1/moov al final), nunca el
// archivo entero -> escanear miles de pistas no gasta RAM.

export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  comment?: string;
  bpm?: number;
  key?: string;
}

const latin1 = new TextDecoder("latin1");
const utf8 = new TextDecoder("utf-8");
const utf16le = new TextDecoder("utf-16le");
const utf16be = new TextDecoder("utf-16be");

function clean(s: string): string {
  return s.replace(/\0+$/g, "").replace(/\0/g, " / ").trim();
}

function decodeText(b: Uint8Array): string {
  if (!b.length) return "";
  const enc = b[0];
  const body = b.subarray(1);
  switch (enc) {
    case 0: return clean(latin1.decode(body));
    case 1: {
      if (body[0] === 0xff && body[1] === 0xfe) return clean(utf16le.decode(body.subarray(2)));
      if (body[0] === 0xfe && body[1] === 0xff) return clean(utf16be.decode(body.subarray(2)));
      return clean(utf16le.decode(body));
    }
    case 2: return clean(utf16be.decode(body));
    default: return clean(utf8.decode(body));
  }
}

function syncsafe(b: Uint8Array, o: number): number {
  return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
}

const ID3_MAP: Record<string, keyof Tags> = {
  TIT2: "title", TT2: "title",
  TPE1: "artist", TP1: "artist",
  TALB: "album", TAL: "album",
  TCON: "genre", TCO: "genre",
  TYER: "year", TDRC: "year", TYE: "year",
  TBPM: "bpm", TBP: "bpm",
  TKEY: "key", TKE: "key",
};

function genreFix(g: string): string {
  // "(17)" o "17" -> no merece una tabla de 192 géneros: se deja el texto si existe
  const m = /^\((\d+)\)(.*)$/.exec(g);
  if (m) return m[2].trim() || g;
  return g;
}

export function parseId3v2(b: Uint8Array): Tags | null {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;
  const ver = b[3];
  const flags = b[5];
  const size = syncsafe(b, 6);
  const end = Math.min(b.length, 10 + size);
  let o = 10;
  if (flags & 0x40 && ver >= 3) {
    const ext = ver === 4 ? syncsafe(b, o) : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) + 4;
    o += ext;
  }
  const tags: Tags = {};
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  while (o + hdrLen <= end) {
    const id = latin1.decode(b.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize: number;
    if (ver === 2) fsize = (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5];
    else if (ver === 4) fsize = syncsafe(b, o + 4);
    else fsize = ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
    const data = b.subarray(o + hdrLen, Math.min(end, o + hdrLen + fsize));
    o += hdrLen + fsize;
    const key = ID3_MAP[id];
    if (key) {
      const v = decodeText(data);
      if (key === "bpm") { const n = parseFloat(v); if (n > 0) tags.bpm = n; }
      else if (key === "genre") tags.genre = genreFix(v);
      else if (!tags[key]) (tags as Record<string, string>)[key] = v;
    } else if ((id === "COMM" || id === "COM") && !tags.comment && data.length > 4) {
      // enc(1) lang(3) desc\0 text
      const enc = data[0];
      const rest = data.subarray(4);
      const wide = enc === 1 || enc === 2;
      let i = 0;
      if (wide) { while (i + 1 < rest.length && !(rest[i] === 0 && rest[i + 1] === 0)) i += 2; i += 2; }
      else { while (i < rest.length && rest[i] !== 0) i++; i += 1; }
      const txt = new Uint8Array(rest.length - i + 1);
      txt[0] = enc; txt.set(rest.subarray(i), 1);
      tags.comment = decodeText(txt);
    }
  }
  return tags;
}

export function parseId3v1(tail: Uint8Array): Tags | null {
  const o = tail.length - 128;
  if (o < 0 || tail[o] !== 0x54 || tail[o + 1] !== 0x41 || tail[o + 2] !== 0x47) return null;
  const s = (a: number, l: number) => clean(latin1.decode(tail.subarray(o + a, o + a + l)));
  return { title: s(3, 30), artist: s(33, 30), album: s(63, 30), year: s(93, 4) };
}

export function parseFlac(b: Uint8Array): Tags | null {
  if (b.length < 8 || latin1.decode(b.subarray(0, 4)) !== "fLaC") return null;
  let o = 4;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (o + 4 <= b.length) {
    const hdr = b[o];
    const type = hdr & 0x7f;
    const len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    o += 4;
    if (type === 4 && o + len <= b.length) {
      let p = o;
      const vlen = dv.getUint32(p, true); p += 4 + vlen;
      const n = dv.getUint32(p, true); p += 4;
      const tags: Tags = {};
      for (let i = 0; i < n && p + 4 <= o + len; i++) {
        const l = dv.getUint32(p, true); p += 4;
        const kv = utf8.decode(b.subarray(p, p + l)); p += l;
        const eq = kv.indexOf("=");
        if (eq < 0) continue;
        const k = kv.slice(0, eq).toUpperCase();
        const v = kv.slice(eq + 1).trim();
        if (k === "TITLE") tags.title = v;
        else if (k === "ARTIST" && !tags.artist) tags.artist = v;
        else if (k === "ALBUM") tags.album = v;
        else if (k === "GENRE") tags.genre = v;
        else if (k === "DATE" || k === "YEAR") tags.year = v;
        else if (k === "COMMENT" || k === "DESCRIPTION") tags.comment = v;
        else if (k === "BPM" || k === "TEMPO") { const x = parseFloat(v); if (x > 0) tags.bpm = x; }
        else if (k === "INITIALKEY" || k === "KEY") tags.key = v;
      }
      return tags;
    }
    if (hdr & 0x80) break;
    o += len;
  }
  return {};
}

export function parseMp4(b: Uint8Array): Tags | null {
  if (b.length < 12 || latin1.decode(b.subarray(4, 8)) !== "ftyp") return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tags: Tags = {};
  const map: Record<string, keyof Tags> = { "©nam": "title", "©ART": "artist", "©alb": "album", "©gen": "genre", "©day": "year", "©cmt": "comment" };
  const walk = (start: number, end: number, depth: number) => {
    let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o);
      const type = latin1.decode(b.subarray(o + 4, o + 8));
      let hdr = 8;
      if (size === 1 && o + 16 <= end) { size = Number(dv.getBigUint64(o + 8)); hdr = 16; }
      if (size === 0) size = end - o;
      if (size < hdr) return;
      const cEnd = Math.min(end, o + size);
      if (type === "moov" || type === "udta" || type === "ilst" || type === "trak") walk(o + hdr, cEnd, depth + 1);
      else if (type === "meta") walk(o + hdr + 4, cEnd, depth + 1);
      else if (depth >= 2 && (map[type] || type === "tmpo")) {
        // dentro: átomo "data" -> 8 hdr + 4 tipo + 4 locale
        const d = o + hdr;
        if (d + 16 <= cEnd && latin1.decode(b.subarray(d + 4, d + 8)) === "data") {
          const payload = b.subarray(d + 16, cEnd);
          if (type === "tmpo") { if (payload.length >= 2) { const v = (payload[0] << 8) | payload[1]; if (v > 0) tags.bpm = v; } }
          else (tags as Record<string, string>)[map[type]] = utf8.decode(payload).trim();
        }
      }
      o += size;
    }
  };
  walk(0, b.length, 0);
  return tags;
}

/** Lee etiquetas de un File (solo cabecera + cola). */
export async function readTags(file: File): Promise<Tags> {
  const HEAD = 512 * 1024;
  const head = new Uint8Array(await file.slice(0, HEAD).arrayBuffer());
  let tags: Tags | null = null;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    // ID3 puede ser mayor que HEAD si lleva carátula grande
    const size = syncsafe(head, 6) + 10;
    const buf = size > HEAD ? new Uint8Array(await file.slice(0, Math.min(size, 8 * 1024 * 1024)).arrayBuffer()) : head;
    tags = parseId3v2(buf);
  } else if (latin1.decode(head.subarray(0, 4)) === "fLaC") {
    tags = parseFlac(head);
  } else if (latin1.decode(head.subarray(4, 8)) === "ftyp") {
    tags = parseMp4(head);
    if (!tags?.title && file.size > HEAD) {
      // moov al final del archivo (habitual en m4a de algunas apps)
      const tailLen = Math.min(file.size, 4 * 1024 * 1024);
      const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer());
      const idx = findAtom(tail, "moov");
      if (idx >= 0) {
        const fake = new Uint8Array(tail.length - idx + 8);
        fake.set([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]); // ftyp falso para reutilizar el parser
        fake.set(tail.subarray(idx), 8);
        tags = { ...parseMp4(fake), ...stripEmpty(tags ?? {}) };
      }
    }
  }
  if (!tags || (!tags.title && !tags.artist)) {
    if (file.size > 128) {
      const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      const v1 = parseId3v1(tail);
      if (v1) tags = { ...v1, ...stripEmpty(tags ?? {}) };
    }
  }
  return tags ?? {};
}

function stripEmpty(t: Tags): Tags {
  const o: Tags = {};
  for (const [k, v] of Object.entries(t)) if (v !== undefined && v !== "") (o as Record<string, unknown>)[k] = v;
  return o;
}

function findAtom(b: Uint8Array, name: string): number {
  const c = [...name].map((ch) => ch.charCodeAt(0));
  for (let i = 4; i + 4 <= b.length; i++) {
    if (b[i] === c[0] && b[i + 1] === c[1] && b[i + 2] === c[2] && b[i + 3] === c[3]) return i - 4;
  }
  return -1;
}

/** "Artista - Título.mp3" -> {artist, title} cuando no hay etiquetas. */
export function tagsFromFilename(name: string): Tags {
  const base = name.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const m = /^\s*(?:\d{1,3}[\s.\-_]+)?(.+?)\s+[-–]\s+(.+)$/.exec(base);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { title: base.trim() };
}
