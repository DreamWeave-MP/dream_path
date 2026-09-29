+++
title = "Embedding Luau"
description = "Give scripts @dream/path through l3i: the feature, the toolchain, composing the extension, the global, and type definitions."
weight = 50

[extra]
kind = "guide"
+++

With the `lua` feature, dream-path is an [l3i](https://github.com/DreamWeave-MP/l3i) extension: it
describes the `@dream/path` module, and a Rust host that runs Luau through l3i composes it into its
runtime. Scripts then get the same rules as Rust, byte for byte. The crate never creates a VM and
never installs a global; both are the host's decisions.

## Dependencies and toolchain

```toml
[dependencies]
dream-path = { version = "0.3", features = ["lua"] }
l3i = "0.1"
```

l3i builds Luau itself, and only with clang, lld and cross-language thin LTO: its build script
refuses any other configuration and names the missing piece. Cargo does not pass a dependency's
configuration on, so the host copies the policy into its own `.cargo/config.toml`, as this crate
does:

```toml
[env]
CXX = "clang++"

[target.x86_64-unknown-linux-gnu]
rustflags = ["-Clinker-plugin-lto", "-Clinker=clang", "-Clink-arg=-fuse-ld=lld"]
```

clang and rustc must use the same LLVM major version. The
[l3i toolchain notes](https://github.com/DreamWeave-MP/l3i/blob/main/TOOLCHAIN.md) have the lines
for macOS and Windows, and the measurements behind the rule.

## Composing the extension

`PathExtension` goes into the host's `RuntimePlan`, next to whatever else the host provides. Every
runtime made from the plan can `require("@dream/path")`:

```rust
use dream_path::lua::PathExtension;
use l3i::Runtime;
use l3i::extension::RuntimePlan;

fn main() -> l3i::Result<()> {
    let plan = RuntimePlan::builder().extension(PathExtension).finalize()?;
    let runtime = Runtime::from_plan(&plan)?;

    runtime.exec(r#"
        local dreamPath = require("@dream/path")
        assert(dreamPath.normalize([[Textures\Tx_Wood_01.DDS]]) == "textures/tx_wood_01.dds")
    "#)
}
```

## The dreamPath global

Scripts written for 0.2 and earlier used a `dreamPath` global. A host that still wants one exposes
the module as a compatibility global through its policy; the global and `require` then return the
same table:

```rust
use dream_path::lua::{MODULE, MODULE_NAME, PathExtension};
use l3i::Runtime;
use l3i::extension::{RuntimePlan, RuntimePolicy};

fn main() -> l3i::Result<()> {
    let policy = RuntimePolicy::new().compat_global(MODULE, MODULE_NAME);
    let plan = RuntimePlan::builder().policy(policy).extension(PathExtension).finalize()?;
    let runtime = Runtime::from_plan(&plan)?;

    runtime.exec(r#"assert(dreamPath == require("@dream/path"))"#)
}
```

`MODULE` is `"@dream/path"` and `MODULE_NAME` is `"dreamPath"`.

## Types for editors and checks

Every function carries a Luau signature. `plan.type_definitions()` returns the `.d.luau` text for
everything in the plan, `@dream/path` included, ready to save for an editor's language server.
With l3i's `analysis` feature, `plan.check_definitions()` type-checks those definitions; this
crate's tests run it, and type-check a strict script against the module, behind the
`luau-analysis` feature (`cargo test --features luau-analysis`), so a plain test run does not
build the analysis frontend.

## What scripts get

- **Byte strings.** A path argument is read as a borrowed view of the Luau string: no copy, no
  UTF-8 requirement. Results can contain invalid UTF-8 and NUL bytes, so a C or C++ host must use
  length-aware Lua APIs.
- **Strings only.** A missing or non-string argument is an error, numbers included; a missing path
  component is `nil`.
- **A frozen module.** Scripts cannot add to or replace its functions.
- **No allocation after warm-up.** Each call normalizes once, into a buffer per thread, and pushes
  the result from there; a path that is already normalized is pushed as it is.

The [Luau API](@/docs/luau/module.md) lists the functions.

## From 0.2

`lua::create_module`, `lua::register_module`, `lua::register_module_as` and the `standalone-lua`
feature are gone, with `mlua`. Compose `PathExtension` as above; the functions, their names and
their results are unchanged.
