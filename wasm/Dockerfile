# Powtarzalne środowisko buildu Pythii do WASM.
# Obraz zawiera emsdk (przypięta wersja) i rozpakowane źródła Pythii.
# Sam build (kompilacja + linkowanie) robi wasm/build-inner.sh na zamontowanym repo.
ARG EMSDK_VERSION=4.0.20
FROM emscripten/emsdk:${EMSDK_VERSION}

ARG PYTHIA_VERSION=8318
ARG PYTHIA_SHA256=85dce1e623f91499b2973e3f939bf760b0f745ad4f4eb1bd0fbce2074e2e8f5c

WORKDIR /opt
RUN curl -fsSL -o pythia.tgz "https://pythia.org/releases/pythia83/pythia${PYTHIA_VERSION}.tgz" \
 && echo "${PYTHIA_SHA256}  pythia.tgz" | sha256sum -c - \
 && tar xzf pythia.tgz \
 && mv "pythia${PYTHIA_VERSION}" pythia \
 && rm pythia.tgz \
 && chmod -R a+rX /opt/pythia

ENV PYTHIA_DIR=/opt/pythia
WORKDIR /src
