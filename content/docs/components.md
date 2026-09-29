+++
title = "Inspecting paths"
description = "Parent, file name and extension of a normalized path, and exactly what each returns at the edges."
weight = 40

[extra]
kind = "guide"
+++

Three helpers split a normalized path at its separators. They are byte operations on `/` and `.`,
nothing more: they do not resolve `..`, recognize drive letters or look at the file system. None of
them allocate.

```rust
use dream_path::NormalizedPath;

fn main() {
    let path = NormalizedPath::new(r"Textures\Architecture\Wall.DDS");
    assert_eq!(path.parent().unwrap(), "textures/architecture");
    assert_eq!(path.file_name().unwrap(), "wall.dds");
    assert_eq!(path.extension().unwrap(), "dds");
}
```

Each has two forms: a method on `NormalizedPath`, and a free function over borrowed bytes,
`parent_normalized`, `file_name_normalized` and `extension_normalized`, for bytes you know are
normalized already. The free functions do not normalize; give them anything else and they split
whatever they were given.

## At the edges

| Path | `parent` | `file_name` | `extension` |
|---|---|---|---|
| `textures/wall.dds` | `textures` | `wall.dds` | `dds` |
| `wall.dds` | none | `wall.dds` | `dds` |
| `music/explore/` | `music` | `explore` | none |
| `archive.tar.gz` | none | `archive.tar.gz` | `gz` |
| `.hidden` | none | `.hidden` | none |
| `notes.` | none | `notes.` | none |
| `sound/fx/../door.wav` | `sound/fx/..` | `door.wav` | `wav` |
| the empty path | none | none | none |

- A trailing separator is ignored when finding the parent and file name, so `music/explore/` has
  the file name `explore`.
- A path ending in `/` has no extension, so `textures/wall.dds/` is not a DDS file.
- A name that starts or ends with its only dot has no extension.
- The extension is the text after the last dot, so `archive.tar.gz` is `gz`.

In Luau, [`fileName`, `parent` and `extension`](@/docs/luau/module.md) normalize their argument
first and then apply the same rules.
