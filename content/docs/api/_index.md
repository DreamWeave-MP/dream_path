+++
title = "Rust API"
description = "Every public function and type in dream-path."
template = "docs/section.html"
page_template = "docs/page.html"
sort_by = "weight"
weight = 90

[extra]
kind = "api"
hide_child_cards = true
+++

Everything is exported from the crate root.

| Page | Covers |
|---|---|
| [Functions](@/docs/api/functions.md) | `normalize_path`, `normalize_path_owned`, `normalize_path_in_place`, `normalize_path_into`, `is_normalized_path`, and `parent_normalized`, `file_name_normalized`, `extension_normalized` |
| [NormalizedPath](@/docs/api/normalized-path.md) | The owned key: constructors, accessors, conversions and trait implementations |
| [Luau extension](@/docs/luau/extension.md) | `lua::PathExtension` and its constants, behind the `lua` feature |

`dream_path::bstr` re-exports the [`bstr`](https://crates.io/crates/bstr) crate, whose `BStr` and
`BString` appear in the API.

## Features

| Feature | Adds |
|---|---|
| `lua` | The `lua` module: [`PathExtension`](@/docs/luau/extension.md), an l3i extension providing `@dream/path` |

Off by default.
