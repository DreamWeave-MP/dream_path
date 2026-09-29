+++
title = "@dream/path"
description = "normalize, isNormalized, fileName, parent, extension and isUtf8, with their Luau type definitions."
weight = 10

[extra]
kind = "api"
+++

```lua
local dreamPath = require("@dream/path")
```

A frozen table of six functions. Each takes a path as a Luau string, read as bytes, and applies
the same [rules](@/docs/rules.md) as the Rust crate. A missing or non-string argument, a number
included, raises an error; a missing path component is `nil`.

## normalize

{{ api_signature(value="normalize(path: string) -> string") }}

The normalized path. An already-normalized path is returned as it is.

```lua
assert(dreamPath.normalize([[//Meshes\x\Ex_Door.NIF]]) == "meshes/x/ex_door.nif")
assert(dreamPath.normalize("///") == "")
```

## isNormalized

{{ api_signature(value="isNormalized(path: string) -> boolean") }}

Whether `normalize` would leave the path unchanged.

## fileName

{{ api_signature(value="fileName(path: string) -> string?") }}

## parent

{{ api_signature(value="parent(path: string) -> string?") }}

## extension

{{ api_signature(value="extension(path: string) -> string?") }}

The final component, everything before it, and its extension without the dot, of the normalized
path: the argument is normalized first, so scripts can pass any spelling. `nil` where the Rust
functions return `None`; [Inspecting paths](@/docs/components.md#at-the-edges) has the table.

```lua
local path = [[Textures\Architecture\Wall.DDS]]
assert(dreamPath.parent(path) == "textures/architecture")
assert(dreamPath.fileName(path) == "wall.dds")
assert(dreamPath.extension(path) == "dds")
assert(dreamPath.extension("music/explore/") == nil)
```

## isUtf8

{{ api_signature(value="isUtf8(path: string) -> boolean") }}

Whether the bytes are valid UTF-8. Paths need not be: a script that wants to display one decides
what to do when this is false.

## Type definitions

What `plan.type_definitions()` generates for the module, for an editor's language server:

```lua
-- module @dream/path (provided by dream.path)
-- Byte-first virtual resource path normalization.
export type Module__dream_path = {
    -- The normalized spelling of a path: `\` to `/`, ASCII lowercase, collapsed separators, no leading separator.
    normalize: (path: string) -> string,
    -- Whether the bytes already have the normalized spelling.
    isNormalized: (path: string) -> boolean,
    -- The final component of the normalized path, or nil.
    fileName: (path: string) -> string?,
    -- The parent portion of the normalized path, or nil.
    parent: (path: string) -> string?,
    -- The extension of the final component without its dot, or nil.
    extension: (path: string) -> string?,
    -- Whether the bytes are valid UTF-8; path data need not be.
    isUtf8: (path: string) -> boolean,
}
declare dreamPath: Module__dream_path
```

The last line appears when the host exposes the [`dreamPath` global](@/docs/luau-hosts.md#the-dreampath-global).
