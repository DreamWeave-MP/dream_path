//! Byte-first normalized virtual resource paths.
//!
//! `dream-path` owns the path normalization shared by archive readers, VFS,
//! resource loading, rendering-side resource lookup, and tooling. The rules are
//! intentionally the boring OpenMW-style virtual path rules:
//!
//! - `\` becomes `/`
//! - ASCII uppercase letters become lowercase
//! - repeated separators collapse
//! - leading separators are discarded
//! - arbitrary non-UTF-8 bytes are preserved
//!
//! The rules are byte-literal: `///` normalizes to an empty byte string, while a
//! non-leading trailing separator is kept (`foo/` stays `foo/`).
//!
//! It does not decode legacy filename encodings, perform Unicode
//! normalization, case-fold non-ASCII text, interpret host filesystem paths, or
//! compute archive-format hashes. Those are separate jobs. Mixing them into the
//! path type would be a small architectural crime, so naturally we avoid doing
//! that.

use std::borrow::Borrow;

use bstr::{BStr, BString, ByteSlice as _};

/// A byte-first normalized virtual resource path.
///
/// Construction always applies [`normalize_path`]. This type is intended for
/// repeated lookups where normalizing the query every time would allocate and
/// burn cycles for no useful reason.
#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct NormalizedPath(BString);

impl NormalizedPath {
    /// Normalize `path` into an owned virtual resource path.
    #[must_use]
    pub fn new(path: impl AsRef<[u8]>) -> Self {
        Self(BString::from(normalize_path(path.as_ref())))
    }

    /// Return this path as a [`BStr`].
    #[must_use]
    pub fn as_bstr(&self) -> &BStr {
        self.0.as_bstr()
    }

    /// Return this path as raw bytes.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Return true if the normalized path is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Return the normalized path length in bytes.
    #[must_use]
    pub fn len(&self) -> usize {
        self.0.len()
    }
}

impl AsRef<[u8]> for NormalizedPath {
    fn as_ref(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl AsRef<BStr> for NormalizedPath {
    fn as_ref(&self) -> &BStr {
        self.as_bstr()
    }
}

impl Borrow<[u8]> for NormalizedPath {
    fn borrow(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl From<&[u8]> for NormalizedPath {
    fn from(path: &[u8]) -> Self {
        Self::new(path)
    }
}

impl From<&str> for NormalizedPath {
    fn from(path: &str) -> Self {
        Self::new(path)
    }
}

impl From<Vec<u8>> for NormalizedPath {
    fn from(path: Vec<u8>) -> Self {
        Self::new(path)
    }
}

impl From<String> for NormalizedPath {
    fn from(path: String) -> Self {
        Self::new(path)
    }
}

impl From<NormalizedPath> for BString {
    fn from(path: NormalizedPath) -> Self {
        path.0
    }
}

impl From<NormalizedPath> for Vec<u8> {
    fn from(path: NormalizedPath) -> Self {
        path.0.into()
    }
}

/// Normalize a virtual resource path into owned bytes.
#[must_use]
pub fn normalize_path(path: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(path.len());
    normalize_path_into(&mut out, path);
    out
}

/// Normalize a virtual resource path into an existing buffer.
///
/// `out` is cleared before writing. Its previous allocation is reused when
/// possible.
pub fn normalize_path_into(out: &mut Vec<u8>, path: &[u8]) {
    out.clear();
    out.reserve(path.len());
    for byte in path.iter().copied() {
        let byte = match byte {
            b'\\' => b'/',
            b'A'..=b'Z' => byte + 32,
            _ => byte,
        };
        if byte == b'/' && (out.is_empty() || out.last() == Some(&b'/')) {
            continue;
        }
        out.push(byte);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use bstr::{BStr, BString};

    use super::{NormalizedPath, normalize_path, normalize_path_into};

    #[test]
    fn leaves_empty_path_empty() {
        assert_eq!(normalize_path(b""), b"");
    }

    #[test]
    fn removes_leading_separators() {
        assert_eq!(normalize_path(b"/foo"), b"foo");
        assert_eq!(normalize_path(b"///foo//bar"), b"foo/bar");
    }

    #[test]
    fn all_separators_normalize_to_empty() {
        assert_eq!(normalize_path(b"/"), b"");
        assert_eq!(normalize_path(br"\\\/"), b"");
    }

    #[test]
    fn keeps_non_leading_trailing_separator() {
        assert_eq!(normalize_path(b"foo/"), b"foo/");
        assert_eq!(normalize_path(br"foo\\"), b"foo/");
    }

    #[test]
    fn folds_backslashes_and_ascii_case() {
        assert_eq!(normalize_path(br"FOO\BaR"), b"foo/bar");
    }

    #[test]
    fn collapses_repeated_separators_after_backslash_folding() {
        assert_eq!(normalize_path(br"foo\\//bar"), b"foo/bar");
    }

    #[test]
    fn preserves_non_ascii_bytes() {
        assert_eq!(normalize_path("Café/Ä".as_bytes()), "café/Ä".as_bytes());
    }

    #[test]
    fn only_ascii_uppercase_is_folded() {
        assert_eq!(normalize_path(b"ABC[\\]^_`XYZ"), b"abc[/]^_`xyz");
    }

    #[test]
    fn preserves_invalid_utf8_bytes() {
        assert_eq!(normalize_path(b"DIR/\xff/FILE"), b"dir/\xff/file");
    }

    #[test]
    fn normalization_is_idempotent() {
        let once = normalize_path(br"//Foo\\BAR///baz");
        let twice = normalize_path(&once);
        assert_eq!(once, twice);
    }

    #[test]
    fn normalize_into_reuses_and_clears_output() {
        let mut out = b"stale".to_vec();
        let capacity = out.capacity();
        normalize_path_into(&mut out, br"/Foo\Bar");
        assert_eq!(out, b"foo/bar");
        assert!(out.capacity() >= capacity);
    }

    #[test]
    fn normalized_path_exposes_bytes_and_length() {
        let path = NormalizedPath::new(br"/Meshes\Thing.NIF");
        assert_eq!(path.as_bytes(), b"meshes/thing.nif");
        assert_eq!(path.as_bstr(), b"meshes/thing.nif".as_slice());
        assert_eq!(path.len(), b"meshes/thing.nif".len());
        assert!(!path.is_empty());
    }

    #[test]
    fn normalized_path_borrows_as_normalized_bytes_for_lookup() {
        let mut values = HashMap::new();
        values.insert(NormalizedPath::new(br"/Meshes\Thing.NIF"), 7);

        assert_eq!(values.get(b"meshes/thing.nif".as_slice()), Some(&7));
    }

    #[test]
    fn normalized_path_as_ref_supports_byte_and_bstr_views() {
        let path = NormalizedPath::new(br"/Textures\Foo.DDS");
        let bytes: &[u8] = path.as_ref();
        let bstr: &BStr = path.as_ref();

        assert_eq!(bytes, b"textures/foo.dds");
        assert_eq!(bstr, b"textures/foo.dds".as_slice());
    }

    #[test]
    fn normalized_path_converts_into_owned_byte_strings() {
        let path = NormalizedPath::new(br"/Icons\Foo.TGA");
        let bstring = BString::from(path.clone());
        let bytes = Vec::<u8>::from(path);

        assert_eq!(bstring, b"icons/foo.tga".as_slice());
        assert_eq!(bytes, b"icons/foo.tga");
    }

    #[test]
    fn from_impls_normalize() {
        assert_eq!(NormalizedPath::from("/Foo").as_bytes(), b"foo");
        assert_eq!(NormalizedPath::from(b"/Foo".as_slice()).as_bytes(), b"foo");
        assert_eq!(
            NormalizedPath::from(String::from("/Foo")).as_bytes(),
            b"foo"
        );
        assert_eq!(NormalizedPath::from(b"/Foo".to_vec()).as_bytes(), b"foo");
    }
}
