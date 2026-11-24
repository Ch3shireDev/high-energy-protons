# HIGH ENERGY PROTONS

Interaktywny symulator zderzeń wysokoenergetycznych w przeglądarce. Fizyka liczona uczciwie, psychodelia wyłącznie w shaderach i dźwięku.

Ustawiasz energię zderzenia, odpalasz zdarzenia, przewijasz je po osi czasu od 10⁻²⁷ s do 10⁻⁸ s i patrzysz, jak cząstki rodzą się, lecą po helisach i rozpadają dalej. Histogramy kątów i mas rosną na żywo i zbiegają do teorii. Skan energii pozwala polować na rezonanse tak, jak odkryto J/ψ w 1974 roku, tylko z bloomem.

Całość to jedna statyczna strona na GitHub Pages. Bez backendu.

> Status: działa tryb e⁺e⁻ (etapy 1–2), klimat (etap 3) i tryb pp z Pythią 8 w WASM (etapy 4–5). Szczegóły i otwarte punkty: `CLAUDE.md`, `wasm/SPIKE.md`.

---

## Funkcje docelowe

- **Dwie osie czasu**
  - wewnątrz zdarzenia: skala logarytmiczna 10⁻²⁷ s → 10⁻⁸ s, scrubbing w przód i w tył,
  - między zdarzeniami: timeline runu jak ścieżka w DAW, z miniaturami i tagami („2 miony”, „K⁰S”, „b-jet”).
- **Aureola prawdopodobieństwa** – przy rozpadzie sfera dP/dΩ w układzie spoczynkowym rodzica + kropka z faktycznie wylosowanym kierunkiem. Przycisk „re-roll”.
- **Analiza na żywo** – histogramy cos θ, mas niezmienniczych, wykresy Dalitza, nakładka z krzywą teoretyczną i χ².
- **Skan rezonansów** – gra z ograniczonym „czasem wiązki”, rozrzutem energii wiązki i Breit–Wignerem.
- **Bump hunting w pp** – widmo mas dimionowych: ω, φ, J/ψ, ψ(2S), Υ, Z, a na deser H → γγ.
- **Dylatacja czasu na żywo** – przełącznik czas własny / laboratoryjny.
- **Klimat** – bloom HDR, świecące ślady, beat-sync z własnym plikiem audio, sonifikacja rozpadów.
- **Science mode** – wyłącza wszystkie efekty, zostawia czyste dane.
- **Linki do zdarzeń** – generacja jest deterministyczna, więc link = seed + ustawienia w URL.

---

## Wierność fizyki

„Physically accurate” znaczy tu trzy poziomy, nazwane wprost w UI:

| Warstwa | Wierność | Źródło |
| --- | --- | --- |
| Kinematyka (czterowektory, boosty, zachowanie) | dokładna | własny TS |
| Twarde procesy e⁺e⁻ (LO) i rozkłady kątowe | dokładna na poziomie LO | własny TS |
| Rozpady: czasy życia, BR, przestrzeń fazowa | dokładna dla znanych BR | dane PDG / Pythia |
| Propagacja: helisa w polu B | dokładna bez strat energii | własny TS |
| Kaskady partonów, hadronizacja (pp, jety) | model zgodny z danymi, nie z pierwszych zasad | Pythia 8 (WASM) |
| Detektor | uproszczony | własny TS |

---

## Architektura

Wszystko działa na froncie. Własny kod w TypeScripcie, Pythia 8 skompilowana do WebAssembly jako czarna skrzynka.

```
          ┌──────────────── przeglądarka ────────────────┐
          │                                              │
 Pythia 8 (WASM, pula Web Workerów) ──┐                  │
 Generator e⁺e⁻ + rozpady (TS) ───────┼─► Bufor zdarzeń ─┼─► Oś czasu ─► Renderer (Three.js)
                                      │   (wierzchołki   │                   ▲
                                      │    x,y,z,t +     ├─► Analiza         │
                                      │    czteropędy)   │   (histogramy,    Web Audio
                                      │                  │    skan σ)        (tylko prezentacja)
          └──────────────────────────────────────────────┘
```

Zasada: wszystkie widoki czytają jeden bufor zdarzeń. Muzyka i efekty sterują tylko renderem, nigdy danymi.

### Pythia w WASM – ustalenia

- Kompilacja Emscriptenem jest wykonalna (Pythia to czyste C++ bez egzotycznych zależności). Wymaga spakowania katalogu `share/Pythia8/xmldoc` do wirtualnego FS.
- PDF-y protonu są wbudowane w Pythię, LHAPDF niepotrzebne.
- **Bez pthreads.** WASM z wątkami wymaga SharedArrayBuffer i nagłówków COOP/COEP, których GitHub Pages nie wysyła. Zamiast tego: kilka Web Workerów, każdy z własną instancją Pythii. Zdarzenia są niezależne, więc to nawet lepsze.
- Cienki wrapper embind (~100 linii C++): ustawienia + seed → `pythia.next()` → zdarzenie jako `Float64Array`.
- **Delphes odpada** (zależy od ROOT). Detektor piszemy sami.
- Nowsze wersje Pythii (8.3xx) mogą wymagać łatek przy kompilacji – do sprawdzenia w spike'u.

---

## Stack

| Warstwa | Wybór |
| --- | --- |
| Build | Vite + TypeScript |
| Renderer | Three.js (WebGPU z fallbackiem WebGL2), post-processing, bloom |
| Generator pp | Pythia 8 → Emscripten → WASM, Web Workers |
| Fizyka własna | TypeScript |
| Wykresy | uPlot lub D3 |
| Audio | Web Audio API (AnalyserNode, beat detection, sonifikacja) |
| Testy | Vitest |
| Hosting | GitHub Pages + GitHub Actions |

---

## Struktura repo

```
wasm/            wrapper.cpp, Dockerfile (emscripten/emsdk), build.sh
src/physics/     kinematyka, dane cząstek, rozpady, procesy e⁺e⁻
src/sim/         helisy, detektor, bufor zdarzeń, RNG
src/analysis/    histogramy, skan σ(√s), Dalitz
src/render/      Three.js, shadery, bloom, trails
src/audio/       beat detection, sonifikacja
src/ui/          oś czasu, panele, HUD
src/workers/     pula workerów z Pythią
data/            dane cząstek (generowane, nie edytowane ręcznie)
tests/           testy fizyki
```

---

## Roadmapa

| # | Etap | Bramka (kryterium zaliczenia) |
| --- | --- | --- |
| 0 | Szkielet: Vite + TS + Three.js, deploy na Pages od pierwszego commita | strona żyje pod URL-em |
| 1 | Rdzeń fizyki w TS + testy | zachowanie E i p, cos θ zgodny z teorią (χ²), średnia droga = βγcτ |
| 2 | Wersja 0: tryb e⁺e⁻, oś czasu, aureola, histogramy, skan rezonansów | skan 2–100 GeV znajduje J/ψ, ψ(2S), Υ, Z na właściwych masach |
| 3 | Klimat: bloom, trails, beat-sync, sonifikacja, Science mode | 60 fps na zwykłym laptopie z efektami |
| 4 | Spike Pythii w WASM (izolowany w `wasm/`) | znane: rozmiar paczki, czas inicjalizacji, ms/zdarzenie w workerze |
| 5 | Integracja pp: pula workerów, uproszczony detektor, widmo dimionowe | widmo pokazuje piki od ω do Z |
| 6 | Szlif: tagi, filtry, linki do zdarzeń, zapisywanie sesji | nigdy się nie kończy |

Wynik spike'a (etap 4) decyduje, czy pp liczy się na żywo, czy zdarzenia trzeba cache'ować.

---

## Ryzyka

| Ryzyko | Co z tym robimy |
| --- | --- |
| „Physically accurate” obiecuje za dużo | poziom wierności widoczny w UI przy każdej warstwie |
| Pythia w WASM: rozmiar, czas startu, łatki | izolowany spike przed integracją |
| Wydajność pp (setki–tysiąc cząstek na zdarzenie) | instancing, LOD, próg p_T do rysowania |
| Helisa bez strat energii | akceptowane w MVP, później polilinie |
| Brak ISR w e⁺e⁻ (pik Z symetryczny) | przełącznik ISR w kolejnej wersji |
| Estetyka zjada fizykę | Science mode, kolor zawsze coś koduje |
| Scope creep (pile-up, Geant4) | twardo poza zakresem |

---

## Licencja

Pythia 8 jest na **GNU GPL v2 lub nowszej**. Projekt rozpowszechnia build WASM Pythii, więc sam musi mieć licencję zgodną z GPL – proponowana **GPL-3.0-or-later**.

Muzyka nie jest dołączana. Użytkownik wczytuje własny plik, analiza odbywa się lokalnie.

---

## Uruchomienie

```bash
npm install
npm run dev          # serwer deweloperski
npm test             # testy fizyki
npm run build        # build produkcyjny do dist/ (kopiuje wasm/dist → public/pythia)
npm run data         # regeneracja data/ z ParticleData.xml Pythii
./wasm/build.sh      # build Pythii do WASM (Docker) – potrzebny przed dev/build dla trybu pp
```
