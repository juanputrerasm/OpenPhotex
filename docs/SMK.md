# Smacker video (`.SMK`)

RAD Game Tools' Smacker format, which Monster Truck Madness 1 and 2 use for their films (MTM2: `VIDEOS\`, listed
in `SYSTEM\EXTRAS.INI [Video]`; MTM1: on the CD). The games play them through RAD's `SMACKW32.DLL`; OpenPhotex
decodes them itself (`src/video/smk.ts`), written from the format's public description. No RAD or other Smacker code
is used.

## Layout

All numbers little-endian. Every bit stream is read least significant bit first.

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | `SMK2` or `SMK4` |
| 4 | 4 | width |
| 8 | 4 | height |
| 12 | 4 | frames |
| 16 | 4 | frame rate: above 0 milliseconds a frame, below 0 hundredths of a millisecond (negated), 0 is 100 ms |
| 20 | 4 | flags: 1 a ring frame follows the last, 2 lines interlaced, 4 lines doubled |
| 24 | 28 | the largest audio chunk of each of 7 tracks |
| 52 | 4 | size of the Huffman trees chunk |
| 56 | 16 | table sizes of the four trees (block map, block colours, full blocks, block types) |
| 72 | 28 | each track's rate: bits 0-23 samples a second; bit 31 packed, bit 30 present, bit 29 16-bit, bit 28 stereo, bit 27 Bink audio |
| 100 | 4 | unused |
| 104 | 4 per frame | frame sizes (+1 with a ring frame); the low two bits are flags (bit 0 a key frame) |
| | 1 per frame | frame types: bit 0 a palette chunk, bit `n + 1` audio of track `n` |
| | trees size | the four trees, in the order above |
| | | the frames |

## Trees

A **byte tree** is read depth first: a 1 bit is a node (its 0 branch, then its 1 branch), a 0 bit a leaf followed by
its 8-bit value. A tree of a single leaf reads no bits when used.

Each of the four **16-bit trees** starts with a present bit (absent: every code is 0 and reads no bits). Then two byte
trees, low and high, each with its own present bit and a closing 0 bit; three 16-bit escape values; the 16-bit tree
itself, read like a byte tree but each leaf read as a code of the low tree and one of the high tree (`low | high << 8`);
a closing bit. A leaf whose value equals escape `k` holds cache entry `k` (the last such leaf when several do), and
reads as 0 until the cache fills it. A tree with no leaf for an escape keeps that cache entry aside.

Using a 16-bit tree returns the leaf's value; when it differs from cache entry 0, the cache shifts (entry 1 to 2,
0 to 1) and entry 0 takes it. Every cache entry goes back to 0 at the start of each frame.

## A frame

1. **Palette** (type bit 0): a byte giving the chunk's size in 4-byte units (the byte counts itself), then commands
   until 256 entries are done: `1xxxxxxx` keeps the next `x + 1` entries; `01xxxxxx o` copies `x + 1` entries from
   entry `o` of the palette before this frame; `00rrrrrr g b` is a new entry of three 6-bit levels, each widened to
   8 bits as `(v << 2) | (v >> 4)`.
2. **Audio**, for each track whose type bit is set: a 4-byte size (counting itself), then the data. Raw tracks are
   PCM (8-bit unsigned, 16-bit signed). A packed track: the unpacked size in bytes, then bits: data present, stereo,
   16-bit; then 1, 2 or 4 byte trees (one per channel, two per channel at 16 bits: low then high byte), each with a
   bit before and after; the first sample of each channel (right first when stereo; 16-bit ones byte-swapped); then
   each next sample is the one before plus the delta its tree gives, wrapping, channels interleaved.
3. **Video**, the rest: the picture in 4 x 4 blocks, row by row, kept from the frame before. A block-type code: bits
   0-1 the type, bits 2-7 the run (1 to 59, then 128, 256, 512, 1024, 2048 blocks), bits 8-15 a colour.
   - **Mono** (0): per block a colour code (high byte for set bits, low byte for clear) and a 16-bit map, four bits a
     row, bit 0 the leftmost pixel.
   - **Full** (1): per block four rows of two codes, the right pair's first; in `SMK4`, a bit 1 first chooses
     doubled rows of one code per half, a 0 then 1 two codes for each two-row half.
   - **Skip** (2): the blocks stay as they were.
   - **Fill** (3): the blocks take the code's colour.

## Evidence

`test/smk.test.ts` builds files bit by bit for each rule, and decodes Monster Truck Madness 2's 48 installed films
(`VIDEOS\`, all `SMK2`, 320 x 240, 15 frames a second, packed 8-bit mono sound at 11025 Hz or 22050 Hz) to their last
frame, the sound as long as the picture. Not exercised by the games' files: `SMK4`, 16-bit and stereo sound, raw
sound, the interlace and doubling flags, Bink audio (not decoded).
