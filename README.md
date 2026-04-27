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

With default features, the crate has one dependency,
[`bstr`](https://crates.io/crates/bstr), used for byte-string storage and views.

Enable the optional embedded Lua API with:

```toml
[dependencies]
dream-path = { version = "0.1", features = ["lua"] }
```

The `lua` feature exposes bindings for an existing `mlua` runtime. It does not
select a Lua backend. Engine and application crates should choose exactly one
shared `mlua` backend at the top of the dependency graph, then enable
`dream-path`'s `lua` feature so this crate can register its table into that
shared runtime.

DreamWeave recommends LuaJIT in 5.2 compatibility mode and does not currently
test these bindings against other Lua runtimes. If a host chooses another
backend, it owns that compatibility burden. A feature matrix is not a prayer
wheel; untested runtime combinations are merely rumors with build scripts.

For standalone documentation builds, examples, and local smoke tests, use:

```toml
[dependencies]
dream-path = { version = "0.1", features = ["standalone-lua"] }
```

`standalone-lua` enables `lua` plus `mlua`'s vendored LuaJIT in 5.2 compatibility
mode (`luajit52`). It is a convenience valve, not the pattern for composing a
large engine. Leaf crates that each summon their own Lua runtime are how you get
linkage tumors.

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
- `foo` and `foo/` are distinct normalized keys
- `HTTP://Foo/Bar` normalizes to `http:/foo/bar`; URI syntax is not preserved
- `C:\Foo` normalizes to `c:/foo`; host path syntax is not interpreted
- `DIR/\xff/FILE` normalizes to `dir/\xff/file`
- `FOO\0BAR` normalizes to `foo\0bar`

It does **not**:

- decode legacy filename encodings
- perform Unicode normalization
- case-fold non-ASCII text
- interpret host filesystem paths
- compute archive-format hashes

Those are separate responsibilities. This crate only defines the shared virtual
resource path spelling. Empty normalized paths and trailing-separator paths are
allowed by this crate; loaders that require file-like resources should reject
those at their own boundary.

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

If the caller already owns the buffer, normalize it without allocating another
one:

```rust
let mut path = br"//Textures\\Foo.DDS".to_vec();
dream_path::normalize_path_in_place(&mut path);
assert_eq!(path, b"textures/foo.dds");

let owned = dream_path::normalize_path_owned(br"//Meshes\\Door.NIF".to_vec());
assert_eq!(owned, b"meshes/door.nif");
```

For hot loops, reuse the caller-owned buffer:

```rust
let mut out = Vec::new();
dream_path::normalize_path_into(&mut out, br"//Textures\\Foo.DDS");
assert_eq!(out, b"textures/foo.dds");
```

`normalize_path_into` clears `out` before writing and reuses its allocation when
possible. This crate does not enforce a maximum path length; archive/tool/Lua
host boundaries should enforce their own byte budgets. If a scratch buffer sees
a huge untrusted input, it can retain that allocation. Discard it if that matters
instead of asking this tiny crate to become a resource governor.

## API shape

- `normalize_path(impl AsRef<[u8]>) -> Vec<u8>`: normalize one path into owned bytes.
- `normalize_path_owned(Vec<u8>) -> Vec<u8>`: normalize an owned buffer while reusing its allocation.
- `normalize_path_in_place(&mut Vec<u8>)`: normalize an existing owned buffer in place.
- `normalize_path_into(&mut Vec<u8>, &[u8])`: normalize into a reusable buffer.
- `is_normalized_path(&[u8]) -> bool`: check whether bytes already match the
  crate's normalized spelling.
- `parent_normalized`, `file_name_normalized`, `extension_normalized`: inspect
  already-normalized borrowed bytes without allocation.
- `NormalizedPath`: owned normalized byte string for repeated lookup keys.

`NormalizedPath::new` and the input `From` impls normalize their input. The
normalized-byte adoption constructors require the caller to provide already
normalized bytes. A constructor that secretly sometimes normalizes and sometimes
does not would be adorable, in the way an intermittent shadow acne regression is
adorable.

`bstr` is part of the public API and is re-exported as `dream_path::bstr`, so
downstream crates do not need a separate direct `bstr` dependency just to name
types returned by this crate. `NormalizedPath` exposes `BStr`/`BString` views and
conversions. It implements `AsRef<[u8]>`, `AsRef<dream_path::bstr::BStr>`,
`Borrow<[u8]>`, and `Borrow<dream_path::bstr::BStr>`, so normalized lookup keys
can be queried without allocating:

```rust
use std::collections::HashMap;

use dream_path::NormalizedPath;

let mut resources = HashMap::new();
resources.insert(NormalizedPath::new(r"/Meshes\Door.NIF"), 42);

assert_eq!(resources.get(b"meshes/door.nif".as_slice()), Some(&42));
```

Borrowed lookups require bytes that are already normalized. For external input,
normalize into a scratch buffer first:

```rust
# use std::collections::HashMap;
# use dream_path::{NormalizedPath, normalize_path_into};
# let mut resources = HashMap::new();
# resources.insert(NormalizedPath::new(r"/Meshes\Door.NIF"), 42);
let mut scratch = Vec::new();
normalize_path_into(&mut scratch, br"Meshes\Door.NIF");
assert_eq!(resources.get(scratch.as_slice()), Some(&42));
```

Consuming conversions are provided for `dream_path::bstr::BString` and `Vec<u8>`
when the normalized bytes need to move into another owner.

String-oriented callers can use `NormalizedPath::to_str`, which is fallible on
purpose:

```rust
use dream_path::NormalizedPath;

let path = NormalizedPath::new("Textures/Foo.DDS");
assert_eq!(path.to_str(), Ok("textures/foo.dds"));

let raw_bytes = NormalizedPath::new(b"textures/\xff.dds");
assert!(raw_bytes.to_str().is_err());
```

`to_str` only proves UTF-8. It does not prove display safety, host path safety,
C-string safety, or absence of embedded NUL. Use length-delimited bytes across
FFI. C strings and resource paths are not the same thing, no matter how many old
engines made them share a trench coat.

Small byte-level helpers are available for virtual resource path inspection:

```rust
use dream_path::{NormalizedPath, bstr::BStr};

let path = NormalizedPath::new("Textures/Architecture/Wall.DDS");
assert_eq!(path.parent(), Some(BStr::new(b"textures/architecture")));
assert_eq!(path.file_name(), Some(BStr::new(b"wall.dds")));
assert_eq!(path.extension(), Some(BStr::new(b"dds")));
```

`extension` returns `None` for paths ending in `/`, so `textures/foo.dds/` does
not masquerade as a DDS file.

These helpers split on `/` only after normalization. They do not resolve `.`,
`..`, drive prefixes, URI schemes, or host filesystem rules. If a renderer needs
glTF URI resolution, that belongs in the renderer/importer. If an archive needs
BA2/BSA hash normalization, that belongs in the archive crate. A path crate that
quietly becomes three different path crates in a trench coat is not an upgrade.

For callers that already have normalized owned bytes,
`NormalizedPath::try_from_normalized_bytes` adopts them without a second
normalization pass and returns the original `Vec<u8>` on rejection. The unchecked
constructor exists for measured hot paths, not for vibes.

## Lua API

With the `lua` feature enabled, hosts can create or register a Lua table:

```rust,no_run
let lua = mlua::Lua::new();
dream_path::lua::register_module(&lua)?; // global `dream_path`
# Ok::<(), mlua::Error>(())
```

For non-global or host-specific namespaces, use the dehardcoded form:

```rust,no_run
let lua = mlua::Lua::new();
let module = dream_path::lua::create_module(&lua)?;
lua.globals().set("paths", module)?;
# Ok::<(), mlua::Error>(())
```

`register_module_as` uses the supplied name as a direct global key. It does not
parse dotted names into nested tables.

Exposed Lua functions:

- `normalize(path: string) -> string`
- `is_normalized(path: string) -> boolean`
- `file_name(path: string) -> string | nil`
- `parent(path: string) -> string | nil`
- `extension(path: string) -> string | nil`
- `is_utf8(path: string) -> boolean`

Lua strings are treated as byte strings. The helpers normalize before splitting,
so scripts can pass ordinary resource paths without manually calling
`normalize` first:

```lua
local path = dream_path.normalize([[Textures\Foo.DDS]])
assert(path == "textures/foo.dds")
assert(dream_path.extension(path) == "dds")
```

Invalid UTF-8 is valid path data in Lua too. If a host wants display text, it can
choose an encoding policy at the host boundary. This crate will not guess. It has
self-respect, or at least a small API surface that resembles it.

Returned Lua strings may contain embedded NUL bytes. C/C++ hosts must use
length-aware Lua APIs, not C string length. Yes, this still needs saying.

Lua path arguments must be strings. Missing or non-string arguments are errors;
missing components are returned as `nil`. These are different things. Naturally,
Lua will let you confuse them if you insist.

## Maturity

This crate is small and the rules are deliberately narrow, but the public API is
still `0.1`. Treat it as ready for shared internal use in DreamWeave/OpenMW-adjacent
code, not as a semver-frozen ecosystem primitive yet.

Before treating it as a widely stable dependency, this should have more property/fuzz coverage for byte inputs,
and whatever trait impls real users need rather than whatever trait impls look nice in the abstract.

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

## Support

Has `dream-path` been useful to you?

If so, please consider [amplifying the signal](https://ko-fi.com/magicaldave) through my ko-fi. 

Thank you for using `dream-path`.
