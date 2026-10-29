import test from "node:test";
import assert from "node:assert/strict";
import { audioSampleRate, detectAudioFormat } from "../src/index.ts";

const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

/** A WAV header with a LIST chunk before "fmt ", as some editors write it. */
function wav(rate: number): Uint8Array {
  return new Uint8Array([...text("RIFF"), ...le32(100), ...text("WAVE"), ...text("LIST"), ...le32(3), 1, 2, 3, 0,
    ...text("fmt "), ...le32(16), 1, 0, 1, 0, ...le32(rate), ...le32(rate * 2), 2, 0, 16, 0]);
}

/** The first Ogg page with a Vorbis identification packet. */
function oggVorbis(rate: number): Uint8Array {
  const header = [...text("OggS"), 0, 2, ...new Array(20).fill(0), 1, 30];
  return new Uint8Array([...header, 1, ...text("vorbis"), 0, 0, 0, 0, 2, ...le32(rate), ...new Array(15).fill(0)]);
}

test("audio probe: WAV, its rate from the fmt chunk past other chunks", () => {
  assert.equal(detectAudioFormat(wav(22050)), "wav");
  assert.equal(audioSampleRate(wav(22050)), 22050);
});

test("audio probe: Ogg Vorbis and Opus", () => {
  assert.equal(detectAudioFormat(oggVorbis(44100)), "ogg");
  assert.equal(audioSampleRate(oggVorbis(44100)), 44100);
  const opus = new Uint8Array([...text("OggS"), 0, 2, ...new Array(20).fill(0), 1, 19, ...text("OpusHead"), 1, 2, 0, 0, ...le32(44100), 0, 0, 0]);
  assert.equal(audioSampleRate(opus), 48000);
});

test("audio probe: MP3 frames, MPEG 1, 2 and 2.5, behind an ID3v2 tag or not", () => {
  // 0xFFFB: MPEG 1 layer III; 0x90: 128 kbit/s at rate index 0 (44100).
  assert.equal(detectAudioFormat(new Uint8Array([0xff, 0xfb, 0x90, 0x64])), "mp3");
  assert.equal(audioSampleRate(new Uint8Array([0xff, 0xfb, 0x90, 0x64])), 44100);
  assert.equal(audioSampleRate(new Uint8Array([0xff, 0xf3, 0x94, 0x64])), 24000); // MPEG 2, index 1
  assert.equal(audioSampleRate(new Uint8Array([0xff, 0xe3, 0x98, 0x64])), 8000); // MPEG 2.5, index 2
  const tagged = new Uint8Array([...text("ID3"), 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5, 0xff, 0xfb, 0x94, 0x64]);
  assert.equal(detectAudioFormat(tagged), "mp3");
  assert.equal(audioSampleRate(tagged), 48000);
});

test("audio probe: anything else is not a sound file", () => {
  assert.equal(detectAudioFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  assert.equal(detectAudioFormat(new Uint8Array([0xff, 0xef, 0x90, 0x64])), null); // reserved version
  assert.equal(audioSampleRate(new Uint8Array(0)), null);
});
