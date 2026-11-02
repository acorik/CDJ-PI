import test from "node:test";
import assert from "node:assert/strict";
import { parseId3v2, parseFlac, parseMp4, tagsFromFilename } from "../src/library/tags";

const enc = new TextEncoder();
function frame(id: string, text: string): number[] {
  const body = [3, ...enc.encode(text)];
  const n = body.length;
  return [...enc.encode(id), (n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255, 0, 0, ...body];
}

test("ID3v2.3", () => {
  const frames = [...frame("TIT2", "Sunrise"), ...frame("TPE1", "DJ Ñandú"), ...frame("TBPM", "126"), ...frame("TKEY", "8A")];
  const n = frames.length;
  const hdr = [0x49, 0x44, 0x33, 3, 0, 0, (n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
  const t = parseId3v2(new Uint8Array([...hdr, ...frames]))!;
  assert.equal(t.title, "Sunrise");
  assert.equal(t.artist, "DJ Ñandú");
  assert.equal(t.bpm, 126);
  assert.equal(t.key, "8A");
});

test("FLAC vorbis comments", () => {
  const le = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];
  const vendor = [...enc.encode("x")];
  const c1 = [...enc.encode("TITLE=Hola")], c2 = [...enc.encode("BPM=128")];
  const body = [...le(vendor.length), ...vendor, ...le(2), ...le(c1.length), ...c1, ...le(c2.length), ...c2];
  const blk = [0x84, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...body];
  const t = parseFlac(new Uint8Array([...enc.encode("fLaC"), ...blk]))!;
  assert.equal(t.title, "Hola");
  assert.equal(t.bpm, 128);
});

test("MP4 ilst", () => {
  const atom = (type: string | number[], payload: number[]) => {
    const tb = typeof type === "string" ? [...enc.encode(type)] : type;
    const n = 8 + payload.length;
    return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255, ...tb, ...payload];
  };
  const data = (s: string) => atom("data", [0, 0, 0, 1, 0, 0, 0, 0, ...enc.encode(s)]);
  const nam = atom([0xa9, 0x6e, 0x61, 0x6d], data("Tema"));
  const ilst = atom("ilst", nam);
  const meta = atom("meta", [0, 0, 0, 0, ...ilst]);
  const moov = atom("moov", atom("udta", meta));
  const ftyp = atom("ftyp", [...enc.encode("M4A "), 0, 0, 0, 0]);
  const t = parseMp4(new Uint8Array([...ftyp, ...moov]))!;
  assert.equal(t.title, "Tema");
});

test("nombre de archivo", () => {
  assert.deepEqual(tagsFromFilename("01 - Artista X - Mi Tema.mp3"), { artist: "Artista X", title: "Mi Tema" });
});
