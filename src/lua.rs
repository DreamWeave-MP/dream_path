//! The `@dream/path` Luau module: byte-first path normalization as an l3i extension.
//!
//! This module is available with the `lua` feature. It never creates a VM: the host composes
//! [`PathExtension`] into an [`l3i::extension::RuntimePlan`] and every runtime made from that
//! plan can `require("@dream/path")`. Names follow Luau conventions: functions are camelCase.
//!
//! Luau strings are byte strings here. Every function takes its path as a borrowed byte view
//! (no copy, no UTF-8 requirement), normalizes it once into a thread-local scratch buffer, and
//! pushes the result straight from that buffer, so a call allocates nothing after warm-up.
//! Returned strings may contain embedded NUL bytes; C hosts must use length-aware Lua APIs
//! rather than C string length.
//!
//! ```no_run
//! use dream_path::lua::{MODULE, MODULE_NAME, PathExtension};
//! use l3i::Runtime;
//! use l3i::extension::{RuntimePlan, RuntimePolicy};
//!
//! // A host that still wants the `dreamPath` global exposes the module as one.
//! let policy = RuntimePolicy::new().compat_global(MODULE, MODULE_NAME);
//! let plan = RuntimePlan::builder().policy(policy).extension(PathExtension).finalize()?;
//! let runtime = Runtime::from_plan(&plan)?;
//! runtime.exec(r#"local path = require("@dream/path") assert(path.normalize([[A\B]]) == "a/b")"#)?;
//! # Ok::<(), l3i::Error>(())
//! ```

use std::cell::RefCell;

use bstr::{BStr, ByteSlice as _};
use l3i::Result;
use l3i::bind::{Call, StackResults};
use l3i::extension::{Extension, ExtensionDescriptor};
use l3i::stack::Scope as _;

use crate::{
    extension_normalized, file_name_normalized, is_normalized_path, normalize_path_into,
    parent_normalized,
};

/// The extension id.
pub const EXTENSION_ID: &str = "dream.path";

/// The module's `require` path.
pub const MODULE: &str = "@dream/path";

/// The conventional compatibility global name, for hosts that expose the module as a global
/// (`RuntimePolicy::compat_global(MODULE, MODULE_NAME)`). The module itself never installs it.
pub const MODULE_NAME: &str = "dreamPath";

/// The `dream.path` extension: provides `@dream/path`.
///
/// The API is intentionally thin and byte-preserving. Path arguments must be Lua strings;
/// missing or non-string arguments are Lua argument errors, and missing path components are
/// returned as `nil`. These are different things, and the binding keeps them different.
#[derive(Clone, Copy, Debug, Default)]
pub struct PathExtension;

impl Extension for PathExtension {
    fn id(&self) -> &'static str {
        EXTENSION_ID
    }

    fn describe(&self, d: &mut ExtensionDescriptor) -> Result<()> {
        d.module(MODULE)
            .doc("Byte-first virtual resource path normalization.")
            .function("normalize", normalize)
            .signature("(path: string) -> string")
            .doc("The normalized spelling of a path: `\\` to `/`, ASCII lowercase, collapsed separators, no leading separator.")
            .function("isNormalized", |path: &[u8]| is_normalized_path(path))
            .signature("(path: string) -> boolean")
            .doc("Whether the bytes already have the normalized spelling.")
            .function("fileName", file_name)
            .signature("(path: string) -> string?")
            .doc("The final component of the normalized path, or nil.")
            .function("parent", parent)
            .signature("(path: string) -> string?")
            .doc("The parent portion of the normalized path, or nil.")
            .function("extension", extension)
            .signature("(path: string) -> string?")
            .doc("The extension of the final component without its dot, or nil.")
            .function("isUtf8", |path: &[u8]| path.is_utf8())
            .signature("(path: string) -> boolean")
            .doc("Whether the bytes are valid UTF-8; path data need not be.");
        Ok(())
    }
}

thread_local! {
    /// The per-thread normalization scratch: one buffer, reused by every call on the thread.
    static SCRATCH: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Runs `body` on the normalized spelling of `path` without allocating: an input that is
/// already normalized is passed through as is, anything else goes through the thread's scratch.
fn with_normalized<R>(path: &[u8], body: impl FnOnce(&[u8]) -> R) -> R {
    if is_normalized_path(path) {
        return body(path);
    }
    SCRATCH.with(|scratch| match scratch.try_borrow_mut() {
        Ok(mut scratch) => {
            normalize_path_into(&mut scratch, path);
            body(&scratch)
        }
        // The scratch is only ever borrowed for the duration of one call, which pushes a Lua
        // value and returns; a nested borrow would mean a re-entrant call, which is served from
        // a fresh buffer rather than refused.
        Err(_) => body(&crate::normalize_path(path)),
    })
}

/// `normalize(path)`: the normalized bytes as a new Lua string.
fn normalize(call: &Call<'_>, path: &[u8]) -> Result<StackResults> {
    with_normalized(path, |normalized| call.push(normalized))?;
    Ok(StackResults)
}

/// Pushes the component `select` picks from the normalized path, or nil.
fn component(
    call: &Call<'_>,
    path: &[u8],
    select: impl FnOnce(&[u8]) -> Option<&BStr>,
) -> Result<StackResults> {
    with_normalized(path, |normalized| match select(normalized) {
        Some(part) => call.push(part.as_bytes()).map(drop),
        None => call.push(&()).map(drop),
    })?;
    Ok(StackResults)
}

/// `fileName(path)`: the last component of the normalized path.
fn file_name(call: &Call<'_>, path: &[u8]) -> Result<StackResults> {
    component(call, path, file_name_normalized)
}

/// `parent(path)`: everything before the last separator of the normalized path.
fn parent(call: &Call<'_>, path: &[u8]) -> Result<StackResults> {
    component(call, path, parent_normalized)
}

/// `extension(path)`: the final component's extension without the dot.
fn extension(call: &Call<'_>, path: &[u8]) -> Result<StackResults> {
    component(call, path, extension_normalized)
}

#[cfg(test)]
mod tests {
    use std::rc::Rc;

    use l3i::Runtime;
    use l3i::extension::{RuntimePlan, RuntimePolicy};

    use super::{MODULE, MODULE_NAME, PathExtension};

    fn plan() -> Rc<RuntimePlan> {
        RuntimePlan::builder()
            .policy(RuntimePolicy::new().compat_global(MODULE, MODULE_NAME))
            .extension(PathExtension)
            .finalize()
            .expect("the extension finalizes")
    }

    fn runtime() -> Runtime {
        Runtime::from_plan(&plan()).expect("a runtime from the plan")
    }

    /// Evaluates `expression` in a script and reads the result back as bytes.
    fn eval_bytes(runtime: &Runtime, expression: &str) -> Vec<u8> {
        let function = runtime
            .load_function(&format!("return function() return {expression} end"))
            .expect("the expression compiles");
        function
            .invoke::<Vec<u8>, ()>(&runtime.stack(), ())
            .expect("the expression evaluates to a string")
    }

    #[test]
    fn module_normalizes_lua_strings_as_bytes() {
        let runtime = runtime();
        assert_eq!(
            eval_bytes(&runtime, r#"dreamPath.normalize("Textures\\Foo.DDS")"#),
            b"textures/foo.dds"
        );
        // Both the canonical `require` path and the host's compatibility global reach one table.
        runtime
            .exec(r#"assert(require("@dream/path") == dreamPath)"#)
            .expect("the module is the global");
    }

    #[test]
    fn module_preserves_invalid_utf8_bytes() {
        let runtime = runtime();
        assert_eq!(
            eval_bytes(&runtime, r#"dreamPath.normalize("DIR/\255/FILE")"#),
            b"dir/\xff/file"
        );
        runtime
            .exec(r#"assert(dreamPath.isUtf8("DIR/\255/FILE") == false) assert(dreamPath.isUtf8("dir/file"))"#)
            .expect("isUtf8 answers for bytes");
    }

    #[test]
    fn module_preserves_embedded_nul_bytes() {
        let runtime = runtime();
        assert_eq!(
            eval_bytes(&runtime, r#"dreamPath.normalize("A\0B")"#),
            b"a\0b"
        );
    }

    #[test]
    fn module_helpers_normalize_before_splitting() {
        let runtime = runtime();
        runtime
            .exec(
                r#"
                local p = "/Textures\\Architecture/Wall.DDS"
                assert(dreamPath.parent(p) == "textures/architecture")
                assert(dreamPath.fileName(p) == "wall.dds")
                assert(dreamPath.extension(p) == "dds")
                assert(dreamPath.isNormalized("textures/architecture/wall.dds"))
                assert(not dreamPath.isNormalized(p))
                assert(dreamPath.normalize("textures/foo.dds") == "textures/foo.dds")
                "#,
            )
            .expect("helpers agree with the byte API");
    }

    #[test]
    fn module_helpers_return_nil_for_missing_components() {
        let runtime = runtime();
        runtime
            .exec(
                r#"
                assert(dreamPath.fileName("/") == nil)
                assert(dreamPath.parent("foo") == nil)
                assert(dreamPath.extension(".hidden") == nil)
                assert(dreamPath.extension("foo.") == nil)
                assert(dreamPath.extension("foo.dds/") == nil)
                "#,
            )
            .expect("missing components are nil");
    }

    #[test]
    fn module_rejects_missing_or_non_string_path_arguments() {
        let runtime = runtime();
        for call in [
            "dreamPath.normalize()",
            "dreamPath.normalize(nil)",
            "dreamPath.normalize(42)",
            "dreamPath.normalize({})",
            "dreamPath.fileName(true)",
        ] {
            let error = runtime
                .exec(&format!("return {call}"))
                .expect_err("a non-string path is an error")
                .to_string();
            // A missing argument is an arity error, a present one of the wrong type a type error.
            assert!(
                error.contains("string") || error.contains("argument count"),
                "{call}: {error}"
            );
        }
    }

    #[test]
    fn module_helpers_preserve_invalid_byte_extensions() {
        let runtime = runtime();
        assert_eq!(
            eval_bytes(&runtime, r#"dreamPath.extension("Foo.\255")"#),
            b"\xff"
        );
    }

    #[test]
    fn the_module_is_frozen_and_typed() {
        let plan = plan();
        let runtime = Runtime::from_plan(&plan).expect("a runtime from the plan");
        let error = runtime
            .exec(r#"require("@dream/path").normalize = nil"#)
            .expect_err("the module is read-only")
            .to_string();
        assert!(error.contains("readonly"), "{error}");
        // The declared types are Luau the frontend accepts, and a strict script that requires
        // the module by its canonical path type checks against the plan's stub.
        plan.check_definitions().expect("the declared types check");
        let definitions = plan.type_definitions();
        assert!(
            definitions.contains("normalize: (path: string) -> string,"),
            "{definitions}"
        );
        assert!(
            definitions.contains("fileName: (path: string) -> string?,"),
            "{definitions}"
        );
        check_strict_script(
            &plan,
            "--!strict\n\
             local path = require('@dream/path')\n\
             local normalized: string = path.normalize('Textures\\\\Foo.DDS')\n\
             local name: string? = path.fileName(normalized)\n\
             local parent: string? = path.parent(normalized)\n\
             local ext: string? = path.extension(normalized)\n\
             local ok: boolean = path.isNormalized(normalized) and path.isUtf8(normalized)\n\
             print(name, parent, ext, ok)\n",
        );
    }

    /// Type checks `script` in strict mode against the plan's definitions and module stubs.
    fn check_strict_script(plan: &Rc<RuntimePlan>, script: &str) {
        use l3i::analysis::{
            Analysis, AnalysisOptions, Definitions, Mode, ModuleConfig, SourceCode, SourceProvider,
        };
        struct Script(String);
        impl SourceProvider for Script {
            fn read_source(&self, name: &str) -> Option<SourceCode> {
                (name == "script").then(|| SourceCode {
                    text: self.0.clone(),
                    is_script: true,
                })
            }
            fn module_config(&self, _: &str) -> ModuleConfig {
                ModuleConfig {
                    mode: Mode::Strict,
                    ..ModuleConfig::default()
                }
            }
        }
        let options = AnalysisOptions {
            definitions: vec![Definitions {
                name: "dream.d.luau".to_owned(),
                source: plan.type_definitions(),
            }],
            ..AnalysisOptions::default()
        };
        let analysis = Analysis::new(plan.analysis_sources(Script(script.to_owned())), options)
            .expect("the analysis frontend accepts the definitions");
        let report = analysis.check("script", false);
        let text: Vec<String> = report
            .diagnostics
            .iter()
            .map(|d| {
                format!(
                    "script:{}:{}: {}",
                    d.span.begin_line + 1,
                    d.span.begin_column + 1,
                    d.text
                )
            })
            .collect();
        assert!(report.is_clean(), "{}", text.join("\n"));
    }
}
