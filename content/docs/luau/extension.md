+++
title = "PathExtension"
description = "The l3i extension that provides @dream/path, and the constants a host uses to expose it."
weight = 20

[extra]
kind = "api"
+++

Rust, in the `lua` module, behind the `lua` feature. [Embedding Luau](@/docs/luau-hosts.md) shows
it in a host.

## PathExtension

{{ api_signature(value="struct PathExtension") }}

The `dream.path` extension: an `l3i::extension::Extension` that describes the `@dream/path` module
and its type signatures. It holds no state; `Clone`, `Copy`, `Debug`, `Default`. Add it to a plan
with `RuntimePlan::builder().extension(PathExtension)`.

It never creates a runtime, picks userdata tags or atoms, or installs a global.

## Constants

{{ api_signature(value='const EXTENSION_ID: &str = "dream.path"') }}

The extension's id in the plan.

{{ api_signature(value='const MODULE: &str = "@dream/path"') }}

The path scripts `require`.

{{ api_signature(value='const MODULE_NAME: &str = "dreamPath"') }}

The conventional global, for hosts that expose the module as one:
`RuntimePolicy::new().compat_global(MODULE, MODULE_NAME)`.
