+++
title = "NormalizedPath"
description = "The owned key: constructors, accessors, inspection, conversions and trait implementations."
weight = 20

[extra]
kind = "api"
+++

{{ api_signature(value="struct NormalizedPath(BString)") }}

An owned, normalized virtual resource path, for storing and looking up. Every way of making one
from arbitrary input normalizes it; the two ways of adopting bytes as they are require them to be
normalized already.

`Clone`, `Debug`, `Default` (the empty path), `Eq`, `Hash`, `Ord` and `PartialOrd`, all over the
normalized bytes. Ordering is byte order.

## Making one

{{ api_signature(value="fn new(path: impl AsRef<[u8]>) -> NormalizedPath") }}

Normalizes `path`.

{{ api_signature(value="impl From<&[u8] | &str | &BStr | Vec<u8> | String | BString> for NormalizedPath") }}

Each normalizes, like `new`.

{{ api_signature(value="fn try_from_normalized_bytes(path: Vec<u8>) -> Result<NormalizedPath, Vec<u8>>") }}

Adopts `path` without copying if it is normalized, and hands it back unchanged as the error if it
is not.

{{ api_signature(value="fn from_normalized_bytes_unchecked(path: Vec<u8>) -> NormalizedPath") }}

Adopts `path` without checking; debug builds assert it. Bytes that are not normalized break
nothing in memory, only lookups: the key will not match its normalized spelling.

## Reading it

{{ api_signature(value="fn as_bytes(&self) -> &[u8]") }}

{{ api_signature(value="fn as_bstr(&self) -> &BStr") }}

{{ api_signature(value="fn to_str(&self) -> Result<&str, Utf8Error>") }}

The key as `&str` when its bytes are valid UTF-8. Valid UTF-8 can still hold NUL and control
bytes; it is not a C string or a display string.

{{ api_signature(value="fn len(&self) -> usize") }}

{{ api_signature(value="fn is_empty(&self) -> bool") }}

Length in bytes, and whether it is the empty path.

## Inspecting

{{ api_signature(value="fn parent(&self) -> Option<&BStr>") }}

{{ api_signature(value="fn file_name(&self) -> Option<&BStr>") }}

{{ api_signature(value="fn extension(&self) -> Option<&BStr>") }}

The same as [`parent_normalized`, `file_name_normalized` and `extension_normalized`](@/docs/api/functions.md#parent-normalized)
on the key's bytes.

## Borrowing and converting

| Implementation | Use |
|---|---|
| `Borrow<[u8]>`, `Borrow<BStr>` | Look a key up in a `HashMap` or `BTreeMap` by normalized bytes, without building a key |
| `AsRef<[u8]>`, `AsRef<BStr>` | Pass a key wherever bytes are accepted |
| `From<NormalizedPath> for Vec<u8>`, `for BString` | Move the bytes out without copying |
