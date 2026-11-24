# CLAUDE.md – HIGH ENERGY PROTONS

Instrukcje dla Claude Code. Opis projektu dla ludzi: `README.md`.

## Czym jest projekt

Symulator zderzeń wysokoenergetycznych w przeglądarce. Jedna statyczna strona na GitHub Pages, bez backendu. Własny kod w TypeScripcie, Pythia 8 skompilowana do WASM.

Nadrzędna zasada: **fizyka jest liczona uczciwie, psychodelia żyje wyłącznie w warstwie prezentacji.** Wszystko, co widać w Science mode, musi być sprawdzalne względem literatury.

## Twarde reguły

1. **Warstwa prezentacji nie czyta i nie modyfikuje stanu fizyki poza bufor zdarzeń (tylko odczyt).** Audio i efekty sterują wyłącznie parametrami renderu. Jeśli efekt wymaga zmiany danych – to nie jest efekt, tylko błąd.
2. **Każda zmiana w `src/physics/` lub `src/sim/` wymaga testu.** Testy fizyki są bramką jakości, nie ozdobą. Nie oznaczaj etapu jako ukończonego, jeśli testy nie przechodzą.
3. **Zero ręcznie wpisanych stałych cząstek w kodzie.** Masy, szerokości, cτ, BR – tylko z `data/`. Plik w `data/` jest generowany skryptem, nie edytowany ręcznie.
4. **Determinizm.** Jeden seedowalny RNG (np. xoshiro128**), przekazywany jawnie. Żadnego `Math.random()` w fizyce. Ten sam seed + ustawienia = to samo zdarzenie, w TS i w Pythii.
5. **Nie piszemy własnej hadronizacji.** Jety z q q̄ bez Pythii są tylko jawnie oznaczonym modelem zabawkowym (`toy: true` w zdarzeniu, etykieta w UI).
6. **Poza zakresem MVP:** pile-up, Geant4, Delphes/ROOT, pthreads w WASM, oscylacje mezonów, łamanie CP, straty energii i rozpraszanie wielokrotne.
7. **Nie dołączamy muzyki** do repo ani builda. Tylko plik wczytany przez użytkownika.
8. Kolor w renderze zawsze coś koduje (rodzaj cząstki, ładunek, energia). Paleta dekoracyjna bez znaczenia – nie.

## Konwencje jednostek

Wewnętrznie, wszędzie:

| Wielkość | Jednostka |
| --- | --- |
| energia, pęd, masa | GeV (c = 1 w kinematyce) |
| długość | mm |
| czas | ns |
| pole magnetyczne | T |
| c | 299.792458 mm/ns |

Konwersje tylko na granicach (UI, import danych). Nazwy zmiennych z jednostką, gdy nie jest oczywista: `ctau_mm`, `t_ns`.

## Fizyka – ściągawka

Promień helisy:

```
r [m] = pT [GeV] / (0.3 · |q| · B [T])
```

Pozycja cząstki w chwili t liczona **analitycznie** z helisy – scrubbing w tył kosztuje tyle samo co w przód. Bez całkowania krok po kroku.

Droga rozpadu: losowana z rozkładu wykładniczego o średniej βγcτ.

Relatywistyczny Breit–Wigner dla rezonansu w e⁺e⁻:

```
σ(s) = (12π / M²) · (Γee·Γf / Γ²) · sΓ² / ((s − M²)² + M²Γ²)
```

Zmierzony pik = splot BW z Gaussem rozrzutu energii wiązki (parametr w UI). Wąskie rezonanse (J/ψ: Γ ≈ 93 keV) przy rozrzucie rzędu MeV są niższe i szersze – to celowa mechanika gry.

Rozkłady kątowe do testów i nakładek:

| Proces | dσ/dcos θ |
| --- | --- |
| e⁺e⁻ → μ⁺μ⁻ (daleko od Z) | 1 + cos²θ |
| e⁺e⁻ → μ⁺μ⁻ (przy Z) | 1 + cos²θ + (8/3)·A_FB·cos θ; A_FB < 0 poniżej piku, > 0 powyżej |
| e⁺e⁻ → φ → K⁺K⁻ | sin²θ |
| H → γγ | izotropowy w układzie spoczynkowym |

Wartości orientacyjne (do weryfikacji z danymi w `data/`): ρ 775 MeV / 149 MeV, ω 783 / 8.7 MeV, φ 1019 / 4.2 MeV, J/ψ 3097 MeV / 93 keV, ψ(2S) 3686 MeV / 0.29 MeV, Υ(1S) 9460 MeV / 54 keV, Z 91.19 / 2.50 GeV, H 125 GeV.

## Źródło danych cząstek

**Decyzja (etap 1):** jedno źródło prawdy to `ParticleData.xml` z Pythii (masy, szerokości, cτ, kanały rozpadu) plus parametry SM i współczynniki biegnącego α_EM z xmldoc i `StandardModel.cc`. Generator: `scripts/gen-data.mjs` (`npm run data`), wersja Pythii w `wasm/pythia-version.env`. Uwaga: Pythia zaokrągla szerokości do 10⁻⁵ GeV (J/ψ: 90 zamiast 93 keV), a BR(Υ(3S) → e⁺e⁻) = 0.

## Pythia w WASM

- Build w Dockerze na obrazie `emscripten/emsdk` – powtarzalny, bez instalowania emsdk lokalnie.
- `share/Pythia8/xmldoc` pakowany przez `--preload-file`.
- **Bez pthreads** (GitHub Pages nie wysyła COOP/COEP). Równoległość = pula Web Workerów, każdy z własną instancją.
- Wrapper embind w `wasm/wrapper.cpp`: wejście = ustawienia + seed, wyjście = `Float64Array` (czteropęd, wierzchołek produkcji x,y,z,t, kod PDG, indeksy rodzic/dzieci, status). Żadnego parsowania tekstu z konsoli.
- Format zdarzenia z Pythii i z generatora TS musi być ten sam (`src/sim/event.ts`).
- Build WASM cache'owany w GitHub Actions (klucz: wersja Pythii + hash wrappera).
- Spike (etap 4) mierzy i zapisuje w `wasm/SPIKE.md`: rozmiar `.wasm` + danych (surowy i gzip), czas inicjalizacji, ms/zdarzenie dla pp przy 13.6 TeV w workerze.

## Komendy

```bash
npm run dev          # Vite dev server
npm test             # Vitest – fizyka musi przechodzić
npm run build        # build produkcyjny do dist/
npm run data         # regeneracja data/ ze źródła
./wasm/build.sh      # build Pythii (Docker)
```

## Struktura

```
wasm/            wrapper.cpp, Dockerfile, build.sh, SPIKE.md
scripts/         generatory danych
data/            dane cząstek (generowane)
src/physics/     kinematyka (czterowektory, boosty), rozpady, procesy e⁺e⁻
src/sim/         event.ts (format zdarzenia), helisy, detektor, RNG
src/analysis/    histogramy, χ², skan σ(√s), Dalitz
src/render/      Three.js, shadery, bloom, trails
src/audio/       beat detection, sonifikacja
src/ui/          oś czasu (log), timeline runu, panele, HUD
src/workers/     pula workerów z Pythią
tests/           testy fizyki
```

## Kolejność pracy

Kolejności nie odwracać. Fizykę w TS da się w pełni przetestować w izolacji; Pythia w WASM to jedyny element, który może zaskoczyć, więc idzie jako osobny spike, nie fundament.

- [ ] **Etap 0 – szkielet.** Vite + TS + Three.js, workflow deploy na Pages. Bramka: strona żyje pod URL-em. *(kod i workflow gotowe, build produkcyjny działa pod podkatalogiem; czeka na włączenie Pages)*
- [x] **Etap 1 – rdzeń fizyki + testy.** Czterowektory, boosty, RNG, dane cząstek, rozpady 2- i 3-ciałowe, helisy. Bramki:
  - zachowanie E i p w każdym zdarzeniu (tolerancja numeryczna),
  - cos θ dla e⁺e⁻ → μ⁺μ⁻ i φ → K⁺K⁻ zgodny z teorią (test χ², ≥ 10⁵ zdarzeń),
  - średnia droga rozpadu = βγcτ w granicach błędu statystycznego,
  - deterministyczność: ten sam seed → identyczne zdarzenie.
- [x] **Etap 2 – wersja 0 (e⁺e⁻).** Suwak √s, procesy μμ, ττ, rezonanse z jawnymi kanałami, jety q q̄ jako toy, logarytmiczna oś czasu, aureola prawdopodobieństwa, histogramy z nakładką teorii, gra w skan z rozrzutem wiązki. Bramka: skan 2–100 GeV znajduje J/ψ, ψ(2S), Υ, Z na właściwych masach.
- [ ] **Etap 3 – klimat.** Bloom, trails, aberracja przy błysku zderzenia, beat-sync z pliku audio, sonifikacja, Science mode. Bramka: 60 fps na zwykłym laptopie z efektami. *(efekty gotowe; 60 fps zmierzone tylko na desktopie)*
- [x] **Etap 4 – spike Pythii.** Izolowany w `wasm/`, wyniki w `wasm/SPIKE.md`.
- [x] **Etap 5 – pp.** Pula workerów, uproszczony detektor (tracker, komory mionowe, później kalorymetr), widmo dimionowe. Bramka: piki od ω do Z widoczne w widmie. *(w widmie prawdy MC; z tłem kombinatorycznym statystyka za mała)*
- [ ] **Etap 6 – szlif.** Tagi i filtry zdarzeń, linki seed+ustawienia w URL, zapisywanie sesji. *(linki w URL gotowe)*

## Wydajność

- Instancing śladów, LOD dla miękkich cząstek, próg p_T do rysowania (konfigurowalny).
- Generacja i histogramowanie w workerach, główny wątek tylko UI i render.
- Typed arrays w buforze zdarzeń, bez obiektów per cząstka na gorącej ścieżce.

## Licencja

Pythia 8: GPL v2 lub nowsza. Projekt: GPL-3.0-or-later. Nie dodawaj zależności z licencją niezgodną z GPL.
