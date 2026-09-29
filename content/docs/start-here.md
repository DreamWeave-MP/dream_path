+++
title = "Start here"
description = "Add the crate, normalize a path, keep it as a key, and look it up."
weight = 10

[extra]
kind = "tutorial"
+++

## Add the crate

```sh
cargo add dream-path
```

It needs Rust 1.88 or newer and brings one dependency, [`bstr`](https://crates.io/crates/bstr), for
byte strings. The optional `lua` feature adds the [Luau module](@/docs/luau-hosts.md).

## Normalize a path

```rust
fn main() {
    let normalized = dream_path::normalize_path(br"Textures\Tx_Wood_01.DDS");
    assert_eq!(normalized, b"textures/tx_wood_01.dds");
}
```

Paths are bytes, not strings: `normalize_path` accepts anything that is `AsRef<[u8]>`, so a
`&str`, a `String`, a `Vec<u8>` or bytes read straight from an archive all work, whatever their
encoding.

## Keep it as a key

When a path is stored and looked up again, keep it as a `NormalizedPath`. It normalizes once, when
it is made, and can be looked up in a map by borrowed bytes:

```rust
use std::collections::HashMap;

use dream_path::{NormalizedPath, normalize_path_into};

fn main() {
    let mut textures = HashMap::new();
    textures.insert(NormalizedPath::new(r"Textures\Tx_Wood_01.DDS"), "wood");

    // A lookup normalizes the query into a buffer the caller keeps and reuses.
    let mut scratch = Vec::new();
    normalize_path_into(&mut scratch, b"//TEXTURES/tx_wood_01.dds");
    assert_eq!(textures.get(scratch.as_slice()), Some(&"wood"));
}
```

The map holds normalized keys, so the query must be normalized too: a borrowed lookup compares
bytes and nothing else. [Keys and lookups](@/docs/keys.md) covers the patterns.

## Next

- [Normalization](@/docs/rules.md): exactly what changes and what does not.
- [Inspecting paths](@/docs/components.md): `parent`, `file_name`, `extension`.
- [Embedding Luau](@/docs/luau-hosts.md), if your program runs scripts.
