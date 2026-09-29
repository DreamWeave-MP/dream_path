# dream-path

Byte-first normalized virtual resource paths for DreamWeave and OpenMW-style asset lookup.

Archive readers, VFS code, resource loading, render-side lookup and tooling all turn a path into a
key. dream-path is the one place that happens, so they agree: five subtly different normalizers is
how you get five subtly different bugs. It normalizes the byte spelling of virtual resource paths.
It is not a file system abstraction.

**Documentation, including the full Rust and Luau API reference:
<https://dreamweave-mp.github.io/dream_path/>**

## Install

```sh
cargo add dream-path
```

One dependency, [`bstr`](https://crates.io/crates/bstr), re-exported as `dream_path::bstr`.

## The rules

- `\` becomes `/`
- ASCII `A` to `Z` become lowercase
- repeated separators collapse, and leading separators are removed
- every other byte is kept: invalid UTF-8, non-ASCII, NUL, `..`, a trailing `/`

No legacy decoding, no Unicode folding, no host path or URI interpretation, no archive hashes.
Those are other crates' jobs.

## Usage

```rust
use std::collections::HashMap;

use dream_path::{NormalizedPath, normalize_path_into};

let mut meshes = HashMap::new();
meshes.insert(NormalizedPath::new(r"//Meshes\x\Ex_Door.NIF"), 7);

// Look up by borrowed bytes: normalize the query into a buffer you reuse.
let mut scratch = Vec::new();
normalize_path_into(&mut scratch, br"Meshes\X\EX_DOOR.nif");
assert_eq!(meshes.get(scratch.as_slice()), Some(&7));
```

## Luau

With the `lua` feature, `dream_path::lua::PathExtension` is an [l3i](https://github.com/DreamWeave-MP/l3i)
extension providing the module `@dream/path`. The host composes it into its `RuntimePlan`; the
crate never creates a VM or installs a global.

```luau
local dreamPath = require("@dream/path")
assert(dreamPath.normalize([[Textures\Foo.DDS]]) == "textures/foo.dds")
assert(dreamPath.extension([[Textures\Foo.DDS]]) == "dds")
```

## Where to read next

- [Normalization](https://dreamweave-mp.github.io/dream_path/docs/rules/): every rule and its
  literal consequences
- [Keys and lookups](https://dreamweave-mp.github.io/dream_path/docs/keys/): which function to use
  where
- [Embedding Luau](https://dreamweave-mp.github.io/dream_path/docs/luau-hosts/): l3i setup, and
  moving from the 0.2 `mlua` binding
- [Rust API](https://dreamweave-mp.github.io/dream_path/docs/api/) and
  [Luau API](https://dreamweave-mp.github.io/dream_path/docs/luau/)
- [Changelog](https://dreamweave-mp.github.io/dream_path/home/changelog/)

## MSRV and license

Rust 1.88. GPL-3.0-only.

## Support

Has dream-path been useful to you? Consider
[amplifying the signal](https://ko-fi.com/magicaldave) through ko-fi.
