// Cienki wrapper embind wokół Pythii 8 – spike (etap 4).
//
// Wejście: ustawienia (linie readString) + seed.
// Wyjście: zdarzenie jako płaski bufor double (Float64Array po stronie JS),
// bez parsowania tekstu z konsoli.
//
// Układ rekordu cząstki (STRIDE = 16 double), indeks 0 = wpis "system" Pythii:
//   0 id (PDG)       1 status       2 mother1     3 mother2
//   4 daughter1      5 daughter2    6 px [GeV]    7 py [GeV]
//   8 pz [GeV]       9 E [GeV]     10 m [GeV]    11 x_mm
//  12 y_mm          13 z_mm        14 t_ns       15 3·ładunek (chargeType)
//
// Pythia trzyma czas wierzchołka w mm/c; konwersja do ns na tej granicy.

#include "Pythia8/Pythia.h"

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <string>
#include <vector>

using namespace Pythia8;
using emscripten::val;

namespace {
constexpr int STRIDE = 16;
constexpr double C_MM_PER_NS = 299.792458;
}  // namespace

class Generator {
 public:
  Generator() : pythia_("/pythia/xmldoc", false) {}

  bool readString(const std::string& line) {
    return pythia_.readString(line, true);
  }

  // Seed inicjalizacji. Pythia akceptuje 0..900000000.
  bool init(int seed) {
    pythia_.readString("Random:setSeed = on");
    pythia_.readString("Random:seed = " + std::to_string(seed));
    return pythia_.init();
  }

  // Kolejne zdarzenie ze strumienia RNG ustawionego przy init().
  bool next() {
    if (!pythia_.next()) return false;
    pack();
    return true;
  }

  // Zdarzenie adresowane seedem: ponowne zasianie RNG przed next().
  // Cel: link "seed + ustawienia" -> dokładnie to samo zdarzenie,
  // niezależnie od tego, co generator robił wcześniej. Test w spike'u
  // sprawdza, czy Pythia nie przenosi stanu między zdarzeniami.
  bool nextWithSeed(int seed) {
    pythia_.rndm.init(seed);
    return next();
  }

  int size() const { return static_cast<int>(buf_.size() / STRIDE); }
  int stride() const { return STRIDE; }

  // Widok na pamięć WASM – ważny tylko do kolejnego next(). JS musi go skopiować.
  val view() const {
    return val(emscripten::typed_memory_view(buf_.size(), buf_.data()));
  }

  double sigmaGenMb() const { return pythia_.info.sigmaGen(); }
  double sigmaErrMb() const { return pythia_.info.sigmaErr(); }
  double nTried() const { return static_cast<double>(pythia_.info.nTried()); }
  double nAccepted() const {
    return static_cast<double>(pythia_.info.nAccepted());
  }

 private:
  void pack() {
    const Event& ev = pythia_.event;
    const int n = ev.size();
    buf_.resize(static_cast<size_t>(n) * STRIDE);
    double* p = buf_.data();
    for (int i = 0; i < n; ++i, p += STRIDE) {
      const Particle& q = ev[i];
      p[0] = q.id();
      p[1] = q.status();
      p[2] = q.mother1();
      p[3] = q.mother2();
      p[4] = q.daughter1();
      p[5] = q.daughter2();
      p[6] = q.px();
      p[7] = q.py();
      p[8] = q.pz();
      p[9] = q.e();
      p[10] = q.m();
      p[11] = q.xProd();
      p[12] = q.yProd();
      p[13] = q.zProd();
      p[14] = q.tProd() / C_MM_PER_NS;
      p[15] = q.chargeType();
    }
  }

  Pythia pythia_;
  std::vector<double> buf_;
};

EMSCRIPTEN_BINDINGS(hep_pythia) {
  emscripten::class_<Generator>("Generator")
      .constructor<>()
      .function("readString", &Generator::readString)
      .function("init", &Generator::init)
      .function("next", &Generator::next)
      .function("nextWithSeed", &Generator::nextWithSeed)
      .function("size", &Generator::size)
      .function("stride", &Generator::stride)
      .function("view", &Generator::view)
      .function("sigmaGenMb", &Generator::sigmaGenMb)
      .function("sigmaErrMb", &Generator::sigmaErrMb)
      .function("nTried", &Generator::nTried)
      .function("nAccepted", &Generator::nAccepted);
}
