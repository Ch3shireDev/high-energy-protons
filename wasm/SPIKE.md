# Spike: Pythia 8 w WASM – na żywo czy cache?

Pytanie z README: czy zdarzenia pp liczyć w przeglądarce na żywo, czy generować offline i serwować z cache'u.

**Odpowiedź (pierwszy pomiar, desktop): na żywo.** Koszt zdarzenia pp przy 13.6 TeV to 0.4–4 ms w jednym workerze, a pula skaluje się prawie liniowo. Jedyny wolny element to `Pythia::init()` dla minimum bias (~3.9 s). Trzeba go ukryć albo cache'ować, ale same zdarzenia nie.

Do potwierdzenia na „zwykłym laptopie” (bramka z etapu 3), patrz [Do zrobienia](#do-zrobienia).

## Jak uruchomić

```bash
./wasm/build.sh                                  # Docker, ~40 s za pierwszym razem
npm run dev                                      # potem http://localhost:5173/spike/
node wasm/spike/node-bench.mjs --d=3             # wariant bez przeglądarki (1 wątek)
```

`npm run dev`/`build` kopiuje `wasm/dist` do `public/pythia/` i stronę spike'a do `public/spike/`. Na GitHub Pages workflow `.github/workflows/pages.yml` buduje WASM (z cache'em w Actions), uruchamia testy i publikuje aplikację; spike jest pod `/spike/`.

Parametry w URL: `?sc=minbias,zmumu&d=3&w=8&auto=1` (scenariusze, sekundy na krok, maks. workerów, start od razu). Przycisk „Kopiuj jako Markdown” daje tabelę do wklejenia poniżej.

## Co jest w buildzie

- Pythia **8.318**, emsdk **4.0.20** (`emscripten/emsdk`), `-O3 -fwasm-exceptions`, bez pthreads.
- `PythiaParallel.cc` pominięty (std::thread).
- Wirtualny FS (`--preload-file`): `xmldoc/`, `tunes/` (potrzebne przy `init`) i tylko dwa PDF-y z ustawień domyślnych: NNPDF2.3 QCD+QED LO (`PDF:pSet = 13`) i H1 2006 Fit B LO dla pomeronu (`PDF:PomSet = 6`, dyfrakcja w SoftQCD). Inny PDF wymaga dopisania pliku do `PDF_FILES` w `build-inner.sh`.
- Wrapper: `wasm/wrapper.cpp`. Zdarzenie to płaski `Float64Array`, 16 liczb na wpis (id, status, rodzice, dzieci, czteropęd, m, x/y/z w mm, t w ns, 3·q).
- Wspólne ustawienia: `ParticleDecays:limitTau0 = on`, `tau0Max = 10 mm`. K⁰S, Λ, π±, μ± zostają dla własnego silnika helis i rozpadów.

## Rozmiar paczki

| plik | surowy | gzip -9 |
| --- | ---: | ---: |
| `pythia.wasm` | 6.53 MiB | 1.98 MiB |
| `pythia.data` | 4.59 MiB | 1.13 MiB |
| `pythia.mjs` | 111 KiB | 29 KiB |
| **razem** | **11.2 MiB** | **3.14 MiB** |

Ładowanie i kompilacja modułu: ~25 ms z dysku lokalnego. Na Pages dojdzie czas sieci, czyli ~3 MiB przy kompresji gzip. Konstruktor `Pythia` (parsowanie xmldoc): ~60 ms.

## Pomiar 2026-11-24: desktop

Intel i7-14700F (28 wątków), Chromium 156 (panel przeglądarki Claude Desktop), localhost, 3 s na krok, do 16 workerów. Pamięć WASM: 64 MiB na worker.

| scenariusz | init [ms] | mediana [ms] | p95 [ms] | 1 worker [/s] | 2 | 4 | 8 | 16 workerów [/s] |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| minimum bias (`SoftQCD:inelastic`) | 3865 | 0.40 | 5.6 | 758 | 1531 | 2800 | 4428 | 6521 |
| twarde QCD, p̂T > 20 GeV | 437 | 3.30 | 10.1 | 243 | 486 | 840 | 1384 | 2104 |
| Z/γ* → μ⁺μ⁻, m̂ > 60 GeV | 426 | 2.90 | 9.8 | 264 | 509 | 922 | 1499 | 2214 |
| tt̄ | 429 | 3.80 | 10.7 | 221 | 445 | 782 | 1286 | 1962 |

Rozmiar zdarzenia (średnia z 300):

| scenariusz | cząstki końc. | naładowane końc. | pełny rekord | → gzip | kompakt (stan końc.) | → gzip | cache 10⁴ zdarzeń |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| minimum bias | 203 | 93 | 76 KiB | 25 KiB | 6.4 KiB | 3.6 KiB | 35 MiB |
| twarde QCD | 416 | 191 | 167 KiB | 56 KiB | 13 KiB | 7.3 KiB | 72 MiB |
| Z → μμ | 382 | 176 | 153 KiB | 51 KiB | 12 KiB | 6.7 KiB | 66 MiB |
| tt̄ | 480 | 219 | 185 KiB | 63 KiB | 15 KiB | 8.6 KiB | 84 MiB |

Determinizm: we wszystkich scenariuszach i 16 workerach

- pierwsze zdarzenie po `init(seed)` jest identyczne bit w bit,
- `nextWithSeed(s)` daje to samo zdarzenie przed innymi zdarzeniami i po nich, w każdym workerze.

Linki „seed + ustawienia → zdarzenie” są więc wykonalne bez cache'u.

Node 24 (ten sam V8, 1 wątek) daje te same liczby z dokładnością do kilku procent.

## Werdykt

Progi są w `spike/bench-core.mjs` (`THRESHOLDS`):

| kryterium | próg | wynik |
| --- | --- | --- |
| zdarzenie na klik | p95 < 100 ms | spełnione z ~10× zapasem (≤ 11 ms) |
| pokaz ciągły z 1 workera | ≥ 10 zdarzeń/s | spełnione z ~20× zapasem |
| histogram 10⁴ zdarzeń z puli | < 30 s | 1.5–5 s (16 workerów), 13–45 s (1 worker) |
| `Pythia::init()` | < 3 s | minimum bias **nie** (3.9 s), reszta ~0.43 s |

Wnioski:

1. **Zdarzenia generujemy na żywo.** Cache zdarzeń kosztowałby 35–85 MiB na 10⁴ zdarzeń (gzip), czyli 10–25× więcej niż cała paczka Pythii, a w przeglądarce te same zdarzenia powstają w kilka sekund.
2. **Init minimum bias trzeba ukryć.** Opcje do sprawdzenia:
   - zapisać tablice MPI przez `MultipartonInteractions:reuseInit` i dołączyć plik do `pythia.data`,
   - startować pulę w tle przy wejściu na stronę,
   - pokazać pierwsze zdarzenie z małego wbudowanego zestawu.
3. **Uwaga do etapu 5 (widmo dimionowe).** „Na żywo” dotyczy przepustowości, nie rzadkich sygnałów. Dimiony z ω, φ, J/ψ w minimum bias są tak rzadkie, że nawet 6500 zdarzeń/s nie zbuduje piku w rozsądnym czasie. Trzeba generować dedykowane procesy (`Charmonium:*`, `Bottomonium:*`, `WeakSingleBoson:*`, wymuszone kanały μμ) z wagami przekrojów, a nie liczyć na cache.
4. Pula: przyspieszenie 2× przy 2 workerach, ~3.7× przy 4, ~6× przy 8, ~8.6× przy 16 (rdzenie P/E i HT). Rozsądna domyślna wielkość puli to `min(hardwareConcurrency − 1, 8)`. Każdy worker zajmuje 64 MiB.

## Do zrobienia

- [ ] Pomiar na zwykłym laptopie (otworzyć stronę na Pages, wkleić Markdown z przycisku).
- [ ] Pomiar z Pages przez sieć: czas pobrania 3 MiB i czy Pages kompresuje `.wasm`/`.data`.
- [ ] Firefox i Safari (`-fwasm-exceptions` wymaga obsługi wyjątków WASM; obecne wersje ją mają).
- [ ] Sprawdzić `MultipartonInteractions:reuseInit` dla init minimum bias.
