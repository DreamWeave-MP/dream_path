# dream-path

Byte-first normalized virtual resource paths for DreamWeave/OpenMW-style asset lookup.

This crate owns the path normalization that archive readers, VFS code, resource
loading, render-side resource lookup, and tooling should all share instead of
quietly reimplementing in five places. Five subtly different normalizers is how
you get five subtly different bugs. Very productive, if your product is bugs.

`dream-path` is not a filesystem abstraction. It normalizes the byte spelling of
virtual resource paths so independent lookup layers can agree on keys.

## Install

```toml
[dependencies]
dream-path = "0.1"
```

The crate currently has one dependency, [`bstr`](https://crates.io/crates/bstr),
used for byte-string storage and views.

## Normalization rules

`dream-path` applies intentionally boring virtual path rules:

- `\` becomes `/`
- ASCII uppercase letters become lowercase
- repeated separators collapse
- leading separators are discarded
- arbitrary non-UTF-8 bytes are preserved

Some consequences are intentionally literal:

- `///` normalizes to the empty byte string
- `/Textures/Foo.dds` normalizes to `textures/foo.dds`
- `foo/` keeps its trailing separator as `foo/`
- `DIR/\xff/FILE` normalizes to `dir/\xff/file`

It does **not**:

- decode legacy filename encodings
- perform Unicode normalization
- case-fold non-ASCII text
- interpret host filesystem paths
- compute archive-format hashes

Those are separate responsibilities. This crate only defines the shared virtual
resource path spelling.

## Usage

Use [`NormalizedPath`](https://docs.rs/dream-path/latest/dream_path/struct.NormalizedPath.html)
when a path will be stored or looked up repeatedly:

```rust
use dream_path::NormalizedPath;

let path = NormalizedPath::new(r"/Meshes\\Dungeons///Door.NIF");
assert_eq!(path.as_bytes(), b"meshes/dungeons/door.nif");
```

For one-off normalization into owned bytes:

```rust
let normalized = dream_path::normalize_path(br"Textures\Foo\BAR.dds");
assert_eq!(normalized, b"textures/foo/bar.dds");
```

For hot loops, reuse the caller-owned buffer:

```rust
let mut out = Vec::new();
dream_path::normalize_path_into(&mut out, br"//Textures\\Foo.DDS");
assert_eq!(out, b"textures/foo.dds");
```

`normalize_path_into` clears `out` before writing and reuses its allocation when
possible.

## API shape

- `normalize_path(&[u8]) -> Vec<u8>`: normalize one path into owned bytes.
- `normalize_path_into(&mut Vec<u8>, &[u8])`: normalize into a reusable buffer.
- `NormalizedPath`: owned normalized byte string for repeated lookup keys.

All `NormalizedPath` constructors and input `From` impls normalize their input.
A constructor that sometimes normalizes and sometimes does not would be
adorable, in the way an intermittent shadow acne regression is adorable.

`NormalizedPath` implements `AsRef<[u8]>`, `AsRef<bstr::BStr>`, and
`Borrow<[u8]>`, so normalized lookup keys can be queried without allocating:

```rust
use std::collections::HashMap;

use dream_path::NormalizedPath;

let mut resources = HashMap::new();
resources.insert(NormalizedPath::new(r"/Meshes\Door.NIF"), 42);

assert_eq!(resources.get(b"meshes/door.nif".as_slice()), Some(&42));
```

Consuming conversions are provided for `bstr::BString` and `Vec<u8>` when the
normalized bytes need to move into another owner.

## Maturity

This crate is small and the rules are deliberately narrow, but the public API is
still `0.1`. Treat it as ready for shared internal use in DreamWeave/OpenMW-adjacent
code, not as a semver-frozen ecosystem primitive yet.

Before treating it as a widely stable dependency, this should probably grow CI,
more property/fuzz coverage for byte inputs, and whatever trait impls real users
need rather than whatever trait impls look nice in the abstract.

## Development

Common checks:

```sh
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
cargo doc --no-deps
```

Focused checks:

```sh
cargo test --lib
cargo test --lib preserves_invalid_utf8_bytes
cargo check --package dream-path
```

## MSRV and license

- MSRV: Rust 1.85
- License: GPL-3.0-only
