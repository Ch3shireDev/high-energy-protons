### Pomiar 2026-11-24

- Przeglądarka: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/6.28899.6 Chrome/156.0.8078.100 Safari/537.36`
- Wątki CPU: 28, crossOriginIsolated: false
- Pythia 8318, emsdk 4.0.20
- `pythia.mjs`: 110.7 KiB (gzip 29.4 KiB)
- `pythia.wasm`: 6.53 MiB (gzip 1.98 MiB)
- `pythia.data`: 4.59 MiB (gzip 1.13 MiB)
- Ładowanie + kompilacja modułu: 27.1 ms, konstruktor Pythii: 56.1 ms

| scenariusz                    | init [ms] | mediana [ms] | p95 [ms] | 1 worker [/s] | pula [/s] | cząstki końc. | cache 10⁴ (gzip) | determinizm | werdykt |
|-------------------------------|----------:|-------------:|---------:|--------------:|----------:|--------------:|-----------------:|-------------|---------|
| pp → Z/γ* → μ⁺μ⁻, m̂ > 60 GeV |       421 |         2.90 |     9.80 |           255 |  531 (2×) |           382 |        65.92 MiB | tak         | live    |