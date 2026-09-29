+++
title = "Compatibility and performance"
description = "What the version number promises before 1.0, the supported Rust, the license, what is tested, and what each call costs."
weight = 60

[extra]
kind = "reference"
+++

## Versions

dream-path is before 1.0: a minor release, 0.3 to 0.4, may break the API, and says how in its
release notes. The rules themselves are the part other crates depend on, and they have not changed
since the first release.

It is ready for shared use across DreamWeave and OpenMW-adjacent code. Before it is treated as a
stable ecosystem primitive, it should gain property and fuzz coverage over arbitrary bytes, and
whatever trait implementations real users turn out to need.

## Rust and license

- **Rust 1.88** or newer, declared as `rust-version`. That is l3i's floor, and it applies with or
  without the `lua` feature.
- **GPL-3.0-only.**

## What is tested

Every push runs [StroggForge](https://github.com/DreamWeave-MP/StroggForge)'s library workflow:
the tests on Windows, Linux, and macOS on both Apple silicon and Intel, Clippy at the pedantic
level with warnings as errors, `rustfmt`, `cargo audit`, and a dry run of the crates.io publish.

The tests check exact normalized bytes rather than strings: invalid UTF-8, non-ASCII bytes, NUL,
repeated and leading separators, and the edge cases of each helper. With the `lua` feature, they
also drive the module through a real Luau runtime, type-check the plan's definitions, and check a
strict script against them.

## What it costs

Measured with Criterion on one core of a loaded machine, minimum of five runs.

`normalize_path_into`, into a reused buffer (`cargo bench --bench normalize`):

| Path | Time |
|---|---:|
| 20 bytes, already normalized | 17 ns |
| 56 bytes, already normalized | 36 ns |
| 56 bytes, only the extension's case to change | 38 ns |
| 56 bytes, mixed spelling | 58 ns |

A call from a Luau script, 1000 per sample (`cargo bench --features lua --bench luau_boundary`),
against the `mlua` binding it replaced in 0.3:

| Call | mlua 0.12 | l3i |
|---|---:|---:|
| `normalize`, mixed spelling, 20 bytes | 258 ns | 120 ns |
| `normalize`, already normalized | 245 ns | 94 ns |
| `normalize`, 56-byte mixed path | 325 ns | 163 ns |
| `isNormalized` | 131 ns | 68 ns |
| `fileName` | 241 ns | 109 ns |
| `parent` | 278 ns | 117 ns |
| `extension` | 273 ns | 113 ns |
| `isUtf8` | 145 ns | 64 ns |

Each release runs the benchmarks in CI and attaches the results to its
[GitHub release](https://github.com/DreamWeave-MP/dream_path/releases) as `BENCHMARKS.md`.
