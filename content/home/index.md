+++
title = "dream-path"
description = "Byte-first normalized virtual resource paths: one spelling for every asset lookup in DreamWeave and OpenMW-style tools."

[taxonomies]
tags = ["OpenMW", "Rust", "Luau", "VFS"]

[extra]
sections = ["overview", "install", "releases", "credits"]
+++

A Morrowind plugin asks for `Textures\Tx_Wood_01.DDS`. The archive stores
`textures\tx_wood_01.dds`. A mod ships `TEXTURES/Tx_Wood_01.dds` as a loose file, and a script
asks for `textures//tx_wood_01.dds`. They are all the same resource, and every layer that looks
one up has to agree on that, or a texture goes missing in one tool and not in another.

dream-path is where that agreement lives. It turns any spelling of a virtual resource path into
one normalized byte string. An archive reader, a VFS, a renderer and a script that all normalize
through it cannot disagree about a key; five slightly different normalizers would be five slightly
different bugs.

{{ schematic(data_path="data/schematics/keys.json") }}

## The rules

- `\` becomes `/`.
- ASCII `A` to `Z` become lowercase.
- Repeated separators collapse to one; leading separators are removed.
- Every other byte is kept exactly: invalid UTF-8, non-ASCII letters, `NUL`, `..`, a trailing `/`.

That is all it does, on purpose. It does not decode legacy encodings, fold Unicode case, resolve
`..`, or interpret host paths, drive letters or URIs. [Normalization](@/docs/rules.md) shows the
literal consequences.

```rust
use dream_path::NormalizedPath;

let key = NormalizedPath::new(r"//Meshes\x\Ex_Door.NIF");
assert_eq!(key.as_bytes(), b"meshes/x/ex_door.nif");
assert_eq!(key.extension().unwrap(), "nif");
```

```luau
local dreamPath = require("@dream/path")
assert(dreamPath.normalize([[Textures\Tx_Wood_01.DDS]]) == "textures/tx_wood_01.dds")
```

## Documentation

- **[Start here](@/docs/start-here.md)**: normalize a path, store a key, look one up.
- **[Guide](@/docs/_index.md)**: the rules, keys and lookups, inspecting paths, and the Luau
  module.
- **[Rust API](@/docs/api/_index.md)** and **[Luau API](@/docs/luau/_index.md)**: every function
  and type.

[dream_archive](https://github.com/DreamWeave-MP/dream_archive) and
[vfstool](https://github.com/DreamWeave-MP/vfstool) build on it. The crate has one dependency,
[`bstr`](https://crates.io/crates/bstr).
