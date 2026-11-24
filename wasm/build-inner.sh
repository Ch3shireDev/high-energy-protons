#!/usr/bin/env bash
# Uruchamiany WEWNĄTRZ kontenera emsdk (patrz build.sh).
set -euo pipefail

: "${PYTHIA_DIR:=/opt/pythia}"
: "${PYTHIA_VERSION:=unknown}"
: "${EMSDK_VERSION:=unknown}"
: "${EM_CACHE:=/src/wasm/.cache/emcache}"
export EM_CACHE
OUT=/src/wasm/dist
OBJ=/src/wasm/.cache/obj-${PYTHIA_VERSION}
STAGE=/src/wasm/.cache/stage
mkdir -p "$OUT" "$OBJ" "$STAGE" "$EM_CACHE"

# Ścieżki w wirtualnym FS. Pythia wyznacza pdfdata jako <xmldoc>/../pdfdata/.
XMLDIR=/pythia/xmldoc/

CXXFLAGS=(-O3 -std=c++17 -fwasm-exceptions -I"$PYTHIA_DIR/include"
  -DXMLDIR="\"$XMLDIR\"" -Wno-deprecated-declarations -w)

echo ">> Kompilacja Pythii (${PYTHIA_VERSION}) – $(nproc) wątków"
# PythiaParallel używa std::thread – bez pthreads nie ma sensu go linkować.
find "$PYTHIA_DIR/src" -name '*.cc' ! -name 'PythiaParallel.cc' -print0 |
  xargs -0 -P "$(nproc)" -I{} bash -c '
    src="$1"; shift
    o="'"$OBJ"'/$(basename "${src%.cc}").o"
    if [[ ! -f "$o" || "$src" -nt "$o" ]]; then em++ "$@" -c "$src" -o "$o"; fi
  ' _ {} "${CXXFLAGS[@]}"

echo ">> Wrapper"
em++ "${CXXFLAGS[@]}" -c /src/wasm/wrapper.cpp -o "$STAGE/wrapper.o"

# Dane: pełny xmldoc (ustawienia + ParticleData.xml), tunes/ (domyślne
# pliki .cmnd tune'ów wczytywane przy init) i tylko te PDF-y, których używają
# ustawienia domyślne:
#   PDF:pSet = 13   -> NNPDF2.3 QCD+QED LO, alpha_s = 0.130 (proton)
#   PDF:PomSet = 6  -> H1 2006 Fit B LO (pomeron, dyfrakcja w SoftQCD)
PDF_FILES=(NNPDF23_lo_as_0130_qed_0000.dat pomH1FitBlo.data)
rm -rf "$STAGE/fs" && mkdir -p "$STAGE/fs/pdfdata"
cp -r "$PYTHIA_DIR/share/Pythia8/xmldoc" "$STAGE/fs/xmldoc"
cp -r "$PYTHIA_DIR/share/Pythia8/tunes" "$STAGE/fs/tunes"
for f in "${PDF_FILES[@]}"; do cp "$PYTHIA_DIR/share/Pythia8/pdfdata/$f" "$STAGE/fs/pdfdata/"; done

echo ">> Linkowanie"
em++ -O3 -fwasm-exceptions --bind \
  "$OBJ"/*.o "$STAGE/wrapper.o" \
  -o "$OUT/pythia.mjs" \
  --preload-file "$STAGE/fs@/pythia" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createPythia \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
  -sSTACK_SIZE=2MB \
  -sEXIT_RUNTIME=0 \
  -sEXPORTED_RUNTIME_METHODS=HEAP8

raw() { stat -c %s "$1"; }
gz()  { gzip -9 -c "$1" | wc -c; }
br()  { if command -v brotli >/dev/null; then brotli -c -q 11 "$1" | wc -c; else echo null; fi; }

cat > "$OUT/build-info.json" <<JSON
{
  "pythiaVersion": "${PYTHIA_VERSION}",
  "emsdkVersion": "$(emcc --version | head -1 | grep -oE "[0-9]+\.[0-9]+\.[0-9]+" | head -1)",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": {
    "pythia.mjs":  { "raw": $(raw "$OUT/pythia.mjs"),  "gzip": $(gz "$OUT/pythia.mjs") },
    "pythia.wasm": { "raw": $(raw "$OUT/pythia.wasm"), "gzip": $(gz "$OUT/pythia.wasm") },
    "pythia.data": { "raw": $(raw "$OUT/pythia.data"), "gzip": $(gz "$OUT/pythia.data") }
  }
}
JSON
cat "$OUT/build-info.json"
