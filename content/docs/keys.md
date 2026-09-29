+++
title = "Keys and lookups"
description = "NormalizedPath in maps, borrowed lookups, scratch buffers, adopting normalized bytes, and which normalizing function to use where."
weight = 30

[extra]
kind = "guide"
+++

Normalization exists so that lookups agree. The crate's API is shaped around doing it once per
path and never allocating on the hot side of a lookup.

## Which function

| You have | Use | Allocates |
|---|---|---|
| A path to store and look up again | `NormalizedPath::new(path)` | The key |
| A borrowed path, and want owned bytes | `normalize_path(path)` | One buffer, the input's size |
| A `Vec<u8>` you no longer need as it was | `normalize_path_in_place(&mut path)` or `normalize_path_owned(path)` | Nothing: the buffer is reused and may get shorter |
| Many lookups in a loop | `normalize_path_into(&mut scratch, path)` | Only when the scratch buffer has to grow |
| Bytes you already normalized, such as keys read from your own index | `NormalizedPath::try_from_normalized_bytes(bytes)` | Nothing; the bytes come back as the error if they are not normalized |

## Keys in maps

`NormalizedPath` owns normalized bytes. It is `Eq`, `Ord` and `Hash` over those bytes, and
`Borrow<[u8]>` and `Borrow<BStr>`, so a `HashMap` or `BTreeMap` keyed by it can be queried with a
plain byte slice, without building a key:

```rust
use std::collections::HashMap;

use dream_path::NormalizedPath;

fn main() {
    let mut meshes = HashMap::new();
    meshes.insert(NormalizedPath::new(r"Meshes\x\Ex_Door.NIF"), 7);

    assert_eq!(meshes.get(b"meshes/x/ex_door.nif".as_slice()), Some(&7));
    assert_eq!(meshes.get(br"Meshes\x\Ex_Door.NIF".as_slice()), None);
}
```

The second lookup misses because a borrowed lookup compares bytes and nothing else: the map cannot
normalize a query for you. Normalize external input first, into a buffer you keep:

```rust
use std::collections::HashMap;

use dream_path::{NormalizedPath, normalize_path_into};

fn main() {
    let mut meshes = HashMap::new();
    meshes.insert(NormalizedPath::new(r"Meshes\x\Ex_Door.NIF"), 7);

    let mut scratch = Vec::new();
    for request in [r"Meshes\X\EX_DOOR.nif", "meshes/x/ex_door.nif"] {
        normalize_path_into(&mut scratch, request.as_bytes());
        assert_eq!(meshes.get(scratch.as_slice()), Some(&7));
    }
}
```

`normalize_path_into` clears the buffer before writing, and a path that is already normalized is
copied in one block, so the common case costs a comparison and a copy.

## Adopting normalized bytes

Keys you wrote yourself, into an index or a cache file, are normalized already; normalizing them
again on load is wasted work.

- `NormalizedPath::try_from_normalized_bytes(bytes)` checks and adopts the `Vec<u8>` without
  copying. If the bytes are not normalized, it hands them back as the error, so you can log,
  repair or normalize them without a clone.
- `NormalizedPath::from_normalized_bytes_unchecked(bytes)` skips the check, which runs only in
  debug builds. Pass it bytes that are not normalized and nothing unsafe happens; lookups just
  miss and duplicates appear. Use it where a profile says the check matters.

## Getting bytes out

- `as_bytes()` and `as_bstr()` borrow the key.
- `Vec<u8>::from(key)` and `BString::from(key)` move the bytes out without copying.
- `to_str()` returns the key as `&str` when it is valid UTF-8, and a `Utf8Error` when it is not.

`to_str` proves UTF-8 and nothing more. The string can still contain NUL bytes, control characters
or anything else a path allowed. It is not a C string, a display string or a host path; pass
paths across FFI with their length.

`bstr` is part of the API, re-exported as `dream_path::bstr`, so a dependent can name `BStr` and
`BString` without a `bstr` dependency of its own.

## Untrusted input

The crate has no length limit. Archive readers, tools and script hosts that take paths from
outside should enforce their own byte budget. A scratch buffer keeps the capacity of the largest
path it has seen, so after a pathological input, drop it or shrink it if the memory matters.
