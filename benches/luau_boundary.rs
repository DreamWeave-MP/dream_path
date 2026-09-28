//! Luau boundary benchmarks: the cost of one `@dream/path` call as a script sees it.
//!
//! The scripts are frozen at the pre-migration commit so the mlua and l3i numbers compare like
//! for like: a module reachable as the global `dreamPath`, `N` calls per script invocation, and
//! Criterion reporting per-call throughput.

use criterion::{Criterion, Throughput, criterion_group, criterion_main};
use dream_path::lua::{MODULE, MODULE_NAME, PathExtension};
use l3i::Runtime;
use l3i::extension::{RuntimePlan, RuntimePolicy};

const CALLS: u64 = 1000;

/// One script per boundary shape; each returns a function that performs `N` calls.
const SCRIPTS: &[(&str, &str)] = &[
    (
        "normalize_mixed",
        r#"return function() for _ = 1, N do dreamPath.normalize("Textures\\Foo\\BAR.dds") end end"#,
    ),
    (
        "normalize_clean",
        r#"return function() for _ = 1, N do dreamPath.normalize("textures/foo/bar.dds") end end"#,
    ),
    (
        "normalize_long",
        r#"return function() for _ = 1, N do dreamPath.normalize("Data Files\\Meshes\\Actors\\Character\\XBase_Anim_Female.NIF") end end"#,
    ),
    (
        "is_normalized",
        r#"return function() for _ = 1, N do dreamPath.isNormalized("textures/foo/bar.dds") end end"#,
    ),
    (
        "file_name",
        r#"return function() for _ = 1, N do dreamPath.fileName("Textures\\Foo\\BAR.dds") end end"#,
    ),
    (
        "parent",
        r#"return function() for _ = 1, N do dreamPath.parent("Textures\\Foo\\BAR.dds") end end"#,
    ),
    (
        "extension",
        r#"return function() for _ = 1, N do dreamPath.extension("Textures\\Foo\\BAR.dds") end end"#,
    ),
    (
        "is_utf8",
        r#"return function() for _ = 1, N do dreamPath.isUtf8("Textures\\Foo\\BAR.dds") end end"#,
    ),
];

fn bench_boundary(c: &mut Criterion) {
    let policy = RuntimePolicy::new().compat_global(MODULE, MODULE_NAME);
    let plan = RuntimePlan::builder()
        .policy(policy)
        .extension(PathExtension)
        .finalize()
        .expect("finalize the plan");
    let runtime = Runtime::from_plan(&plan).expect("a runtime from the plan");
    runtime.exec(&format!("N = {CALLS}")).expect("set N");
    let mut group = c.benchmark_group("luau_boundary");
    group.throughput(Throughput::Elements(CALLS));
    for (name, script) in SCRIPTS {
        let function = runtime.load_function(script).expect("compile script");
        group.bench_function(*name, |b| {
            b.iter(|| {
                function
                    .invoke::<(), ()>(&runtime.stack(), ())
                    .expect("run script");
            });
        });
    }
    group.finish();
}

criterion_group!(benches, bench_boundary);
criterion_main!(benches);
