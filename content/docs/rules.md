+++
title = "Normalization"
description = "The four rules, the bytes they leave alone, and the literal results that follow."
weight = 20

[extra]
kind = "guide"
+++

A normalized path is the key every lookup agrees on. The rules that produce it are few and
deliberately literal, because every component that uses the crate has to get byte-for-byte the
same answer.

## The rules

| Input | Becomes |
|---|---|
| `\` | `/` |
| ASCII `A` to `Z` | `a` to `z` |
| Two or more separators in a row | One `/` |
| Separators at the start | Nothing |

Every other byte passes through unchanged. Normalizing an already-normalized path returns it as it
is, so it is always safe to normalize twice.

## What comes out

| Path | Normalized |
|---|---|
| `Textures\Tx_Wood_01.DDS` | `textures/tx_wood_01.dds` |
| `/Textures/Foo.dds` | `textures/foo.dds` |
| `Meshes//x\\Ex_Door.NIF` | `meshes/x/ex_door.nif` |
| `///` | the empty path |
| `Music/Explore/` | `music/explore/` |
| `Sound/Fx/../FX/Door.WAV` | `sound/fx/../fx/door.wav` |
| `C:\Morrowind\Data Files` | `c:/morrowind/data files` |
| `HTTP://Example/Foo` | `http:/example/foo` |
| `Été/Ärger.DDS` | `Été/Ärger.dds` |
| `DIR/\xff/FILE` | `dir/\xff/file` |
| `FOO\0BAR` | `foo\0bar` |

`\xff` and `\0` stand for the single bytes 0xFF and 0x00.

Some of those are surprising on purpose:

- **A trailing separator stays.** `music/explore/` and `music/explore` are different keys.
- **The empty path is a path.** `///` normalizes to zero bytes.
- **`..` is just two dots.** Nothing is resolved; `sound/fx/../fx/door.wav` is its own key.
- **Host syntax is not recognized.** A drive letter or a URI scheme is normalized like any other
  text, and comes out mangled.
- **Only ASCII changes case.** `É` stays `É`: non-ASCII bytes are data, not letters.
- **Invalid UTF-8 and NUL bytes survive.** A path is bytes, and whatever encoding a plugin or
  archive used is preserved.

A loader that needs a file-like resource should reject empty paths and trailing separators at its
own boundary. This crate only defines the spelling.

## What it does not do

Each of these is a separate job, done by the code that knows the context:

- **Decoding legacy encodings.** Morrowind-era data carries Windows code pages; which one is a
  question for the reader of that data.
- **Unicode normalization or case folding.** Two spellings of `É` stay two keys.
- **Resolving paths.** No `.` or `..`, no roots, no drive letters, no URIs. A glTF importer that
  resolves relative URIs does that before it asks for a key.
- **Host file system paths.** A normalized path is a key into a virtual file system, not something
  to open.
- **Archive hashes.** BSA and BA2 have their own hash rules; the archive crate owns them.

## Normalized, exactly

`is_normalized_path(bytes)` is true when normalizing `bytes` would not change them: no ASCII
uppercase, no `\`, no leading separator, no two separators in a row. It says nothing else about
the path. The empty path, `c:/foo`, `a/../b` and bytes that are not UTF-8 are all normalized.
