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
//!
//! ## Lua API
//!
//! Enable the `lua` feature to embed the same byte-preserving normalization API
//! into an existing [`mlua::Lua`] state. [`lua::create_module`] builds the API
//! table without registering a global, while [`lua::register_module`] installs it
//! as the default `dream_path` global.
//!
//! The Lua API treats Lua strings as raw path bytes, preserving invalid UTF-8 and
//! embedded NUL bytes. It is embed-only: this crate does not provide a `cdylib`
//! Lua module loader, and hosts that already own a different Lua runtime should
//! bind the Rust byte API themselves.

use std::{borrow::Borrow, str::Utf8Error};

use bstr::{BStr, BString};

pub use bstr::ByteSlice;

#[cfg(feature = "lua")]
pub mod lua;

/// A byte-first normalized virtual resource path.
///
/// [`NormalizedPath::new`] and the input [`From`] impls apply [`normalize_path`].
/// The normalized-byte adoption constructors require the caller to provide bytes
/// that are already normalized. This type is intended for repeated lookups where
/// normalizing the query every time would allocate and burn cycles for no useful
/// reason.
#[derive(Clone, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct NormalizedPath(BString);

impl NormalizedPath {
    /// Normalize `path` into an owned virtual resource path.
    #[must_use]
    pub fn new(path: impl AsRef<[u8]>) -> Self {
        Self(BString::from(normalize_path(path.as_ref())))
    }

    /// Build from bytes that are already normalized.
    ///
    /// Returns the original bytes on rejection so callers can log, repair, or
    /// normalize them without cloning first. Use this when avoiding a second
    /// normalization pass matters and the caller can handle rejection.
    ///
    /// # Errors
    ///
    /// Returns the original `path` when it does not satisfy
    /// [`is_normalized_path`].
    pub fn try_from_normalized_bytes(path: Vec<u8>) -> Result<Self, Vec<u8>> {
        if is_normalized_path(&path) {
            Ok(Self(BString::from(path)))
        } else {
            Err(path)
        }
    }

    /// Build from bytes that are already normalized without checking them.
    ///
    /// `path` should satisfy [`is_normalized_path`]. Passing non-normalized bytes
    /// breaks the logical invariant that every [`NormalizedPath`] contains
    /// normalized virtual path spelling. That can produce cache misses and
    /// duplicate keys. It is not memory-unsafe; it is just wrong, which is quite
    /// bad enough.
    #[must_use]
    pub fn from_normalized_bytes_unchecked(path: Vec<u8>) -> Self {
        debug_assert!(is_normalized_path(&path));
        Self(BString::from(path))
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

    /// Return this path as UTF-8 when the normalized bytes are valid UTF-8.
    ///
    /// This is a convenience for string-oriented callers. It is not a promise
    /// that virtual resource paths are Unicode, display-safe, C-string-safe, or
    /// host filesystem paths. Valid UTF-8 paths may still contain NUL bytes.
    ///
    /// # Errors
    ///
    /// Returns [`Utf8Error`] if the path contains invalid UTF-8 bytes.
    pub fn to_str(&self) -> Result<&str, Utf8Error> {
        std::str::from_utf8(self.as_bytes())
    }

    /// Return the final non-empty component of this virtual path.
    ///
    /// A trailing separator is ignored for component extraction, so `foo/bar/`
    /// has file name `bar`.
    #[must_use]
    pub fn file_name(&self) -> Option<&BStr> {
        file_name_normalized(self.as_bytes())
    }

    /// Return the parent portion of this virtual path.
    ///
    /// This is a byte-level virtual path operation. It does not interpret `.`,
    /// `..`, drive prefixes, roots, or host filesystem rules.
    #[must_use]
    pub fn parent(&self) -> Option<&BStr> {
        parent_normalized(self.as_bytes())
    }

    /// Return the extension of the final component, without the dot.
    ///
    /// Dotfiles such as `.hidden`, names ending in `.`, and paths ending in `/`
    /// have no extension.
    #[must_use]
    pub fn extension(&self) -> Option<&BStr> {
        extension_normalized(self.as_bytes())
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

impl Borrow<BStr> for NormalizedPath {
    fn borrow(&self) -> &BStr {
        self.as_bstr()
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

impl From<&BStr> for NormalizedPath {
    fn from(path: &BStr) -> Self {
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

impl From<BString> for NormalizedPath {
    fn from(path: BString) -> Self {
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

/// Return true if `path` already matches this crate's normalized spelling.
///
/// This checks byte spelling only. It does not mean that `path` is a valid
/// file-like resource, safe host path, URI, display string, or archive path.
/// Empty paths, trailing separators, NUL bytes, invalid UTF-8, dot segments,
/// and already-mangled host/URI-looking strings such as `c:/foo` or
/// `http:/foo/bar` may all be normalized according to this predicate.
#[must_use]
pub fn is_normalized_path(path: &[u8]) -> bool {
    let mut previous_was_separator = true;
    for &byte in path {
        match byte {
            b'\\' | b'A'..=b'Z' => return false,
            b'/' if previous_was_separator => return false,
            b'/' => previous_was_separator = true,
            _ => previous_was_separator = false,
        }
    }
    true
}

/// Return the final non-empty component of an already-normalized virtual path.
///
/// A trailing separator is ignored for component extraction, so `foo/bar/` has
/// file name `bar`. The input is assumed to satisfy [`is_normalized_path`]; this
/// function does not normalize, validate resource suitability, or interpret host
/// filesystem syntax.
#[must_use]
pub fn file_name_normalized(path: &[u8]) -> Option<&BStr> {
    let bytes = without_trailing_separator(path);
    if bytes.is_empty() {
        return None;
    }
    let start = bytes
        .iter()
        .rposition(|byte| *byte == b'/')
        .map_or(0, |pos| pos + 1);
    Some(bytes[start..].as_bstr())
}

/// Return the parent portion of an already-normalized virtual path.
///
/// The input is assumed to satisfy [`is_normalized_path`]. This is a byte-level
/// virtual path operation; it does not resolve `.`, `..`, roots, drive prefixes,
/// URI schemes, or host filesystem rules.
#[must_use]
pub fn parent_normalized(path: &[u8]) -> Option<&BStr> {
    let bytes = without_trailing_separator(path);
    let end = bytes.iter().rposition(|byte| *byte == b'/')?;
    Some(bytes[..end].as_bstr())
}

/// Return the extension of the final component of an already-normalized virtual
/// path, without the dot.
///
/// Dotfiles such as `.hidden`, names ending in `.`, and paths ending in `/` have
/// no extension. The input is assumed to satisfy [`is_normalized_path`].
#[must_use]
pub fn extension_normalized(path: &[u8]) -> Option<&BStr> {
    if path.ends_with(b"/") {
        return None;
    }
    let file_name = file_name_normalized(path)?.as_bytes();
    let dot = file_name.iter().rposition(|byte| *byte == b'.')?;
    if dot == 0 || dot + 1 == file_name.len() {
        return None;
    }
    Some(file_name[dot + 1..].as_bstr())
}

/// Normalize a virtual resource path into owned bytes.
#[must_use]
pub fn normalize_path(path: impl AsRef<[u8]>) -> Vec<u8> {
    let path = path.as_ref();
    let mut out = Vec::with_capacity(path.len());
    normalize_path_into(&mut out, path);
    out
}

/// Normalize an owned virtual resource path, reusing its allocation.
///
/// This is a convenience for callers that already own a byte buffer and do not
/// need to preserve the original spelling. It has the same normalization rules
/// as [`normalize_path`].
#[must_use]
pub fn normalize_path_owned(mut path: Vec<u8>) -> Vec<u8> {
    normalize_path_in_place(&mut path);
    path
}

/// Normalize an owned virtual resource path in place.
///
/// The buffer is rewritten using the same rules as [`normalize_path`]. Its
/// allocation is reused; its length may shrink when leading or repeated
/// separators are removed.
pub fn normalize_path_in_place(path: &mut Vec<u8>) {
    let mut write = 0;
    let mut previous_was_separator = true;
    for read in 0..path.len() {
        let byte = match path[read] {
            b'\\' => b'/',
            b'A'..=b'Z' => path[read] + 32,
            byte => byte,
        };
        if byte == b'/' && previous_was_separator {
            continue;
        }
        path[write] = byte;
        write += 1;
        previous_was_separator = byte == b'/';
    }
    path.truncate(write);
}

/// Normalize a virtual resource path into an existing buffer.
///
/// `out` is cleared before writing. Its previous allocation is reused when
/// possible. This crate does not enforce a maximum path length; callers handling
/// untrusted archive, tool, or Lua input should enforce their own byte budget.
/// A scratch buffer can retain a large allocation after a pathological input, so
/// discard or shrink it at the caller boundary if that matters.
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

fn without_trailing_separator(bytes: &[u8]) -> &[u8] {
    bytes.strip_suffix(b"/").unwrap_or(bytes)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use bstr::{BStr, BString};

    use super::{
        NormalizedPath, extension_normalized, file_name_normalized, is_normalized_path,
        normalize_path, normalize_path_in_place, normalize_path_into, normalize_path_owned,
        parent_normalized,
    };

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
    fn preserves_nul_bytes() {
        assert_eq!(normalize_path(b"FOO\0BAR"), b"foo\0bar");
        assert_eq!(normalize_path(b"DIR/\0/FILE"), b"dir/\0/file");
    }

    #[test]
    fn does_not_resolve_dot_segments() {
        assert_eq!(normalize_path(b"A/./B"), b"a/./b");
        assert_eq!(normalize_path(b"A/../B"), b"a/../b");
        assert_eq!(
            NormalizedPath::new(b"Foo/../BAR").parent(),
            Some(BStr::new(b"foo/.."))
        );
    }

    #[test]
    fn does_not_preserve_uri_or_host_path_syntax() {
        assert_eq!(normalize_path(b"HTTP://Foo/Bar"), b"http:/foo/bar");
        assert_eq!(normalize_path(br"C:\Foo"), b"c:/foo");
        assert_eq!(
            normalize_path(br"\\Server\Share\File"),
            b"server/share/file"
        );
    }

    #[test]
    fn trailing_separator_remains_part_of_key() {
        let file = NormalizedPath::new("textures/foo.dds");
        let directory_like = NormalizedPath::new("textures/foo.dds/");

        assert_ne!(file, directory_like);
        assert_eq!(directory_like.as_bytes(), b"textures/foo.dds/");
    }

    #[test]
    fn normalization_is_idempotent() {
        let once = normalize_path(br"//Foo\\BAR///baz");
        let twice = normalize_path(&once);
        assert_eq!(once, twice);
    }

    #[test]
    fn normalization_invariants_hold_for_byte_corpus() {
        let mut cases: Vec<Vec<u8>> = (0u8..=u8::MAX).map(|byte| vec![byte]).collect();
        cases.extend([
            b"".to_vec(),
            br"//Foo\\BAR///baz".to_vec(),
            b"HTTP://Foo/Bar".to_vec(),
            br"C:\Foo".to_vec(),
            br"\\Server\Share\File".to_vec(),
            b"A/./B".to_vec(),
            b"A/../B".to_vec(),
            b"DIR/\0/FILE".to_vec(),
            b"DIR/\xff/FILE".to_vec(),
            br"/A//B\\C/".to_vec(),
        ]);

        for case in cases {
            let normalized = normalize_path(&case);
            assert!(
                is_normalized_path(&normalized),
                "normalized output failed predicate: {case:?}"
            );
            assert_eq!(
                normalize_path(&normalized),
                normalized,
                "normalization was not idempotent: {case:?}"
            );
            assert!(
                !normalized.contains(&b'\\'),
                "backslash survived normalization: {case:?}"
            );
            assert!(
                !normalized.iter().any(u8::is_ascii_uppercase),
                "uppercase ASCII survived normalization: {case:?}"
            );
            assert!(
                !normalized.starts_with(b"/"),
                "leading slash survived normalization: {case:?}"
            );
            assert!(
                !normalized.windows(2).any(|window| window == b"//"),
                "repeated slash survived normalization: {case:?}"
            );
        }
    }

    #[test]
    fn detects_already_normalized_paths() {
        assert!(is_normalized_path(b""));
        assert!(is_normalized_path(b"textures/foo.dds"));
        assert!(is_normalized_path(b"textures/foo/"));
        assert!(is_normalized_path(b"textures/\xff/file"));
        assert!(is_normalized_path(b"foo\0bar"));
        assert!(is_normalized_path(b"foo/../bar"));
        assert!(is_normalized_path(b"c:/foo"));

        assert!(!is_normalized_path(b"/textures/foo.dds"));
        assert!(!is_normalized_path(b"textures//foo.dds"));
        assert!(!is_normalized_path(br"textures\foo.dds"));
        assert!(!is_normalized_path(b"textures/FOO.dds"));
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
    fn normalize_owned_and_in_place_reuse_existing_storage() {
        let mut path = br"//Textures\\Foo///BAR.DDS".to_vec();
        let capacity = path.capacity();
        normalize_path_in_place(&mut path);
        assert_eq!(path, b"textures/foo/bar.dds");
        assert_eq!(path.capacity(), capacity);

        assert_eq!(
            normalize_path_owned(br"//Meshes\\Door.NIF".to_vec()),
            b"meshes/door.nif"
        );
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
    fn normalized_path_reports_utf8_only_when_valid() {
        assert_eq!(
            NormalizedPath::new("Textures/Foo.DDS").to_str(),
            Ok("textures/foo.dds")
        );
        assert!(NormalizedPath::new(b"textures/\xff.dds").to_str().is_err());
        assert_eq!(NormalizedPath::new(b"A\0B").to_str(), Ok("a\0b"));
    }

    #[test]
    fn normalized_path_exposes_virtual_components() {
        let path = NormalizedPath::new(br"/Textures/Architecture/Wall.DDS");
        assert_eq!(path.parent(), Some(BStr::new(b"textures/architecture")));
        assert_eq!(path.file_name(), Some(BStr::new(b"wall.dds")));
        assert_eq!(path.extension(), Some(BStr::new(b"dds")));

        let directory_like = NormalizedPath::new("textures/foo/");
        assert_eq!(directory_like.parent(), Some(BStr::new(b"textures")));
        assert_eq!(directory_like.file_name(), Some(BStr::new(b"foo")));
        assert_eq!(directory_like.extension(), None);
    }

    #[test]
    fn normalized_path_extension_is_byte_literal() {
        assert_eq!(
            NormalizedPath::new("foo.tar.gz").extension(),
            Some(BStr::new(b"gz"))
        );
        assert_eq!(NormalizedPath::new(".hidden").extension(), None);
        assert_eq!(NormalizedPath::new("foo.").extension(), None);
        assert_eq!(NormalizedPath::new("foo.dds/").extension(), None);
        assert_eq!(
            NormalizedPath::new(b"foo.\xff").extension(),
            Some(BStr::new(b"\xff"))
        );
    }

    #[test]
    fn normalized_component_helpers_operate_on_borrowed_bytes() {
        let path = b"textures/architecture/wall.dds";

        assert_eq!(
            parent_normalized(path),
            Some(BStr::new(b"textures/architecture"))
        );
        assert_eq!(file_name_normalized(path), Some(BStr::new(b"wall.dds")));
        assert_eq!(extension_normalized(path), Some(BStr::new(b"dds")));
        assert_eq!(extension_normalized(b"textures/foo.dds/"), None);
    }

    #[test]
    fn checked_normalized_constructor_rejects_unnormalized_bytes() {
        let path = NormalizedPath::try_from_normalized_bytes(b"textures/foo.dds".to_vec())
            .expect("path is already normalized");
        assert_eq!(path.as_bytes(), b"textures/foo.dds");
        assert_eq!(
            NormalizedPath::try_from_normalized_bytes(b"textures/foo/".to_vec())
                .expect("trailing separator is normalized")
                .as_bytes(),
            b"textures/foo/"
        );

        for path in [
            b"Textures/Foo.DDS".as_slice(),
            b"/textures/foo.dds".as_slice(),
            b"textures//foo.dds".as_slice(),
            br"textures\foo.dds".as_slice(),
        ] {
            let rejected = NormalizedPath::try_from_normalized_bytes(path.to_vec())
                .expect_err("path is not normalized");
            assert_eq!(rejected, path);
        }
    }

    #[test]
    fn normalized_path_borrows_as_normalized_bytes_for_lookup() {
        let mut values = HashMap::new();
        values.insert(NormalizedPath::new(br"/Meshes\Thing.NIF"), 7);

        assert_eq!(values.get(b"meshes/thing.nif".as_slice()), Some(&7));
        assert_eq!(values.get(BStr::new(b"meshes/thing.nif")), Some(&7));
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
        let bstring = BString::from(b"/Foo".to_vec());

        assert_eq!(NormalizedPath::from("/Foo").as_bytes(), b"foo");
        assert_eq!(NormalizedPath::from(b"/Foo".as_slice()).as_bytes(), b"foo");
        assert_eq!(NormalizedPath::from(BStr::new(&bstring)).as_bytes(), b"foo");
        assert_eq!(
            NormalizedPath::from(String::from("/Foo")).as_bytes(),
            b"foo"
        );
        assert_eq!(NormalizedPath::from(b"/Foo".to_vec()).as_bytes(), b"foo");
        assert_eq!(
            NormalizedPath::from(BString::from(b"/Foo".to_vec())).as_bytes(),
            b"foo"
        );
    }
}
