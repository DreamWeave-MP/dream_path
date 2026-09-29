//! The Rust normalization core: one call of `normalize_path_into` per input shape, with the
//! output buffer reused as a hot loop would.

use std::hint::black_box;

use criterion::{Criterion, criterion_group, criterion_main};
use dream_path::{is_normalized_path, normalize_path_in_place, normalize_path_into};

const CASES: &[(&str, &[u8])] = &[
    ("clean_short", b"textures/foo/bar.dds"),
    ("mixed_short", b"Textures\\Foo\\BAR.dds"),
    (
        "clean_long",
        b"data files/meshes/actors/character/xbase_anim_female.nif",
    ),
    (
        "mixed_long",
        b"Data Files\\Meshes\\Actors\\Character\\XBase_Anim_Female.NIF",
    ),
    (
        "late_change",
        b"data files/meshes/actors/character/xbase_anim_female.NIF",
    ),
    ("leading_separators", b"//Textures\\\\Foo.DDS"),
];

fn bench_normalize(c: &mut Criterion) {
    let mut group = c.benchmark_group("normalize_path_into");
    for (name, input) in CASES {
        let mut out = Vec::with_capacity(input.len());
        group.bench_function(*name, |b| {
            b.iter(|| {
                normalize_path_into(&mut out, black_box(input));
                black_box(&out);
            });
        });
    }
    group.finish();

    let mut group = c.benchmark_group("is_normalized_path");
    for (name, input) in CASES {
        group.bench_function(*name, |b| b.iter(|| is_normalized_path(black_box(input))));
    }
    group.finish();

    let mut group = c.benchmark_group("normalize_path_in_place");
    for (name, input) in CASES {
        group.bench_function(*name, |b| {
            let mut buffer = Vec::with_capacity(input.len());
            b.iter(|| {
                buffer.clear();
                buffer.extend_from_slice(black_box(input));
                normalize_path_in_place(&mut buffer);
                black_box(&buffer);
            });
        });
    }
    group.finish();
}

criterion_group!(benches, bench_normalize);
criterion_main!(benches);
