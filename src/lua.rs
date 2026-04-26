//! Embedded Lua bindings for byte-first path normalization.
//!
//! This module is available with the `lua` feature. It does not define a
//! `cdylib` Lua module; hosts embed it into their own [`mlua::Lua`] state and
//! choose the namespace they want.
//!
//! The feature selects `mlua` with vendored `LuaJIT` in 5.2 compatibility mode.
//! Libraries should avoid enabling it transitively unless they own the embedding
//! runtime. Hosts using a different Lua runtime should bind the Rust byte API
//! themselves.
//! Returned Lua strings may contain embedded NUL bytes; C hosts must use
//! length-aware Lua APIs rather than C string length.

use bstr::ByteSlice as _;
use mlua::{Error, Lua, Result, String as LuaString, Table, Value};

use crate::{NormalizedPath, is_normalized_path, normalize_path};

/// Default Lua global name used by [`register_module`].
pub const MODULE_NAME: &str = "dream_path";

/// Create the `dream_path` Lua API table without registering it globally.
///
/// The API is intentionally thin and byte-preserving. Lua strings are treated
/// as byte strings; invalid UTF-8 is accepted anywhere a path is accepted.
/// Path arguments must be Lua strings. Missing or non-string arguments are Lua
/// argument errors; missing path components are returned as `nil`.
///
/// # Errors
///
/// Returns an error if creating Lua functions or strings fails.
pub fn create_module(lua: &Lua) -> Result<Table> {
    let module = lua.create_table()?;
    module.set(
        "normalize",
        lua.create_function(|lua, path: Value| {
            let path = expect_string(path)?;
            lua.create_string(normalize_path(path.as_bytes()).as_slice())
        })?,
    )?;
    module.set(
        "is_normalized",
        lua.create_function(|_, path: Value| {
            let path = expect_string(path)?;
            Ok(is_normalized_path(path.as_bytes().as_ref()))
        })?,
    )?;
    module.set(
        "file_name",
        lua.create_function(|lua, path: Value| {
            let path = expect_string(path)?;
            component(lua, &path, NormalizedPath::file_name)
        })?,
    )?;
    module.set(
        "parent",
        lua.create_function(|lua, path: Value| {
            let path = expect_string(path)?;
            component(lua, &path, NormalizedPath::parent)
        })?,
    )?;
    module.set(
        "extension",
        lua.create_function(|lua, path: Value| {
            let path = expect_string(path)?;
            component(lua, &path, NormalizedPath::extension)
        })?,
    )?;
    module.set(
        "is_utf8",
        lua.create_function(|_, path: Value| {
            let path = expect_string(path)?;
            Ok(path.as_bytes().as_ref().is_utf8())
        })?,
    )?;
    Ok(module)
}

/// Register the Lua API table as the `dream_path` global.
///
/// # Errors
///
/// Returns an error if creating or assigning the module table fails.
pub fn register_module(lua: &Lua) -> Result<()> {
    register_module_as(lua, MODULE_NAME)
}

/// Register the Lua API table under a caller-selected global name.
///
/// This is the dehardcoding valve for hosts that want a different namespace.
/// `name` is used as a direct key in [`Lua::globals`]; dotted names such as
/// `"foo.bar"` are not parsed into nested tables.
///
/// # Errors
///
/// Returns an error if `name` is empty or if creating or assigning the module
/// table fails.
pub fn register_module_as(lua: &Lua, name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(Error::RuntimeError(
            "Lua module global name must not be empty".to_owned(),
        ));
    }
    let module = create_module(lua)?;
    lua.globals().set(name, module)
}

fn component(
    lua: &Lua,
    path: &LuaString,
    select: impl FnOnce(&NormalizedPath) -> Option<&bstr::BStr>,
) -> Result<Option<LuaString>> {
    let path = NormalizedPath::new(path.as_bytes());
    select(&path)
        .map(|value| lua.create_string(value.as_bytes()))
        .transpose()
}

fn expect_string(value: Value) -> Result<LuaString> {
    match value {
        Value::String(value) => Ok(value),
        value => Err(Error::FromLuaConversionError {
            from: value.type_name(),
            to: "string".to_owned(),
            message: Some("path arguments must be Lua strings".to_owned()),
        }),
    }
}

#[cfg(test)]
mod tests {
    use mlua::{Lua, String as LuaString};

    use super::{MODULE_NAME, register_module, register_module_as};

    #[test]
    fn module_normalizes_lua_strings_as_bytes() {
        let lua = Lua::new();
        register_module(&lua).expect("module registration should succeed");

        let normalized: LuaString = lua
            .load(r#"return dream_path.normalize("Textures\\Foo.DDS")"#)
            .eval()
            .expect("normalization should succeed");

        assert_eq!(normalized.as_bytes().as_ref(), b"textures/foo.dds");
    }

    #[test]
    fn module_preserves_invalid_utf8_bytes() {
        let lua = Lua::new();
        register_module(&lua).expect("module registration should succeed");

        let normalized: LuaString = lua
            .load(r#"return dream_path.normalize("DIR/\255/FILE")"#)
            .eval()
            .expect("normalization should succeed");
        let is_utf8: bool = lua
            .load(r#"return dream_path.is_utf8("DIR/\255/FILE")"#)
            .eval()
            .expect("UTF-8 check should succeed");

        assert_eq!(normalized.as_bytes().as_ref(), b"dir/\xff/file");
        assert!(!is_utf8);
    }

    #[test]
    fn module_preserves_embedded_nul_bytes() {
        let lua = Lua::new();
        register_module(&lua).expect("module registration should succeed");

        let normalized: LuaString = lua
            .load(r#"return dream_path.normalize("A\0B")"#)
            .eval()
            .expect("normalization should succeed");

        assert_eq!(normalized.as_bytes().as_ref(), b"a\0b");
    }

    #[test]
    fn module_helpers_normalize_before_splitting() {
        let lua = Lua::new();
        register_module(&lua).expect("module registration should succeed");

        let values: (LuaString, LuaString, LuaString, bool) = lua
            .load(
                r#"
                return
                    dream_path.parent("/Textures\\Architecture/Wall.DDS"),
                    dream_path.file_name("/Textures\\Architecture/Wall.DDS"),
                    dream_path.extension("/Textures\\Architecture/Wall.DDS"),
                    dream_path.is_normalized("textures/architecture/wall.dds")
                "#,
            )
            .eval()
            .expect("helper calls should succeed");

        assert_eq!(values.0.as_bytes().as_ref(), b"textures/architecture");
        assert_eq!(values.1.as_bytes().as_ref(), b"wall.dds");
        assert_eq!(values.2.as_bytes().as_ref(), b"dds");
        assert!(values.3);
    }

    #[test]
    fn module_helpers_return_nil_for_missing_components() {
        let lua = Lua::new();
        register_module(&lua).expect("module registration should succeed");

        let values: (
            Option<LuaString>,
            Option<LuaString>,
            Option<LuaString>,
            Option<LuaString>,
        ) = lua
            .load(
                r#"
                return
                    dream_path.file_name("/"),
                    dream_path.parent("foo"),
                    dream_path.extension(".hidden"),
                    dream_path.extension("foo.")
                "#,
            )
            .eval()
            .expect("helper calls should succeed");

        assert!(values.0.is_none());
        assert!(values.1.is_none());
        assert!(values.2.is_none());
        assert!(values.3.is_none());
    }

    #[test]
    fn module_rejects_missing_or_non_string_path_arguments() {
        let lua = Lua::new();
        register_module(&lua).expect("module registration should succeed");

        assert!(
            lua.load("return dream_path.normalize()")
                .eval::<LuaString>()
                .is_err()
        );
        assert!(
            lua.load("return dream_path.normalize(nil)")
                .eval::<LuaString>()
                .is_err()
        );
        assert!(
            lua.load("return dream_path.normalize(42)")
                .eval::<LuaString>()
                .is_err()
        );
        assert!(
            lua.load("return dream_path.normalize({})")
                .eval::<LuaString>()
                .is_err()
        );
    }

    #[test]
    fn module_helpers_preserve_invalid_byte_extensions() {
        let lua = Lua::new();
        register_module(&lua).expect("module registration should succeed");

        let extension: LuaString = lua
            .load(r#"return dream_path.extension("Foo.\255")"#)
            .eval()
            .expect("extension should succeed");

        assert_eq!(extension.as_bytes().as_ref(), b"\xff");
    }

    #[test]
    fn module_can_be_registered_under_custom_name() {
        let lua = Lua::new();
        register_module_as(&lua, "paths").expect("module registration should succeed");

        let normalized: LuaString = lua
            .load(r#"return paths.normalize("Meshes\\Door.NIF")"#)
            .eval()
            .expect("normalization should succeed");
        let default_global_exists: bool = lua
            .load(format!(r"return {MODULE_NAME} ~= nil"))
            .eval()
            .expect("global check should succeed");

        assert_eq!(normalized.as_bytes().as_ref(), b"meshes/door.nif");
        assert!(!default_global_exists);
    }

    #[test]
    fn module_rejects_empty_registration_name() {
        let lua = Lua::new();

        assert!(register_module_as(&lua, "").is_err());
    }
}
