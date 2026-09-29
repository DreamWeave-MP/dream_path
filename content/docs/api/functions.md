+++
title = "Functions"
description = "The normalizing functions, is_normalized_path, and the inspection functions over normalized bytes."
weight = 10

[extra]
kind = "api"
+++

The normalizing functions all apply the same [rules](@/docs/rules.md); they differ only in where
the result goes. [Keys and lookups](@/docs/keys.md) says which to use where.

## normalize_path

{{ api_signature(value="fn normalize_path(path: impl AsRef<[u8]>) -> Vec<u8>") }}

The normalized bytes of `path`, in a new buffer with room for the whole input.

## normalize_path_owned

{{ api_signature(value="fn normalize_path_owned(path: Vec<u8>) -> Vec<u8>") }}

Normalizes a buffer you own and returns it. The allocation is reused; the length can shrink.

## normalize_path_in_place

{{ api_signature(value="fn normalize_path_in_place(path: &mut Vec<u8>)") }}

`normalize_path_owned` through a reference. An already-normalized buffer is left untouched.

## normalize_path_into

{{ api_signature(value="fn normalize_path_into(out: &mut Vec<u8>, path: &[u8])") }}

Clears `out` and writes the normalized bytes of `path` into it, reusing its allocation. The
already-normalized start of `path` is copied as one block, and only the rest is rewritten. The
function for loops: one buffer, reused for every query.

`out` keeps the capacity of the longest path it has held; there is no length limit.

## is_normalized_path

{{ api_signature(value="fn is_normalized_path(path: &[u8]) -> bool") }}

Whether normalizing `path` would leave it unchanged: no ASCII uppercase, no `\`, no leading
separator, no repeated separator. It checks spelling only. The empty path, a trailing separator,
`..`, NUL, invalid UTF-8 and host-looking text like `c:/foo` can all be normalized.

## parent_normalized

{{ api_signature(value="fn parent_normalized(path: &[u8]) -> Option<&BStr>") }}

Everything before the last `/`, ignoring one trailing separator; `None` when there is no `/`.

## file_name_normalized

{{ api_signature(value="fn file_name_normalized(path: &[u8]) -> Option<&BStr>") }}

Everything after the last `/`, ignoring one trailing separator; `None` for the empty path.

## extension_normalized

{{ api_signature(value="fn extension_normalized(path: &[u8]) -> Option<&BStr>") }}

The final component's text after its last `.`. `None` when the path ends in `/`, when the name has
no dot, or when its only dot is the first or last byte.

The three inspection functions expect normalized bytes and do not normalize. They are the borrowed
forms of the [`NormalizedPath`](@/docs/api/normalized-path.md#inspecting) methods;
[Inspecting paths](@/docs/components.md) tabulates their results at the edges.
