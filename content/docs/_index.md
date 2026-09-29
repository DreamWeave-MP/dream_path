+++
title = "Documentation"
description = "How dream-path normalizes virtual resource paths, how to use the result as a key, and its complete Rust and Luau API."
template = "docs/section.html"
page_template = "docs/page.html"
sort_by = "weight"

[extra]
docs_root = true
docs_project_name = "dream-path"
docs_short_title = "dream-path docs"
docs_project_path = "@/home/index.md"
docs_repository_url = "https://github.com/DreamWeave-MP/dream_path/tree/main/content/docs"
docs_sidebar_label = "Documentation"
hide_child_cards = true
kind = "guide"
+++

dream-path does one thing: it gives every virtual resource path one spelling, so the components
that store and look up resources agree on keys. The API is small; the rules are the part that
matters, because every crate that uses it depends on them being exactly the same everywhere.

## Learn it

- **[Start here](@/docs/start-here.md)**: normalize a path, keep it as a key, look it up.
- **[Normalization](@/docs/rules.md)**: the four rules, what they leave alone, and the literal
  results that follow.

## Use it

- **[Keys and lookups](@/docs/keys.md)**: `NormalizedPath` in maps, borrowed lookups, scratch
  buffers, and which normalizing function to use where.
- **[Inspecting paths](@/docs/components.md)**: parent, file name and extension, byte by byte.
- **[Embedding Luau](@/docs/luau-hosts.md)**: giving scripts `@dream/path` through l3i.
- **[Compatibility and performance](@/docs/compatibility.md)**: what the version promises, the
  supported Rust, and what each call costs.

## Look it up

- **[Rust API](@/docs/api/_index.md)**: the normalizing functions, the inspection functions and
  `NormalizedPath`.
- **[Luau API](@/docs/luau/_index.md)**: the `@dream/path` module and the extension a host
  composes.
