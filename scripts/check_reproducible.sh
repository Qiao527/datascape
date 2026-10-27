#!/usr/bin/env bash
# Regenerates the data of each piece from its public sources and checks that
# the committed files in public/data/ are reproduced byte for byte.
#
#   python -m pip install -r scripts/requirements.txt
#   scripts/check_reproducible.sh                 # storm water heart tides
#   scripts/check_reproducible.sh storm tides     # just these
#
# Downloads (about 300 MB, mostly the two CUDEM tiles) go to $DATASCAPE_CACHE,
# or to a temporary directory that is removed afterwards. Every downloaded file
# is checked against the SHA-256 it had when the data were made, so a changed
# upstream file is reported as such, not as a broken generator. Between Tides
# also reads NOAA's CO-OPS API live; that is covered by the output comparison.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
python="${PYTHON:-python3}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cache="${DATASCAPE_CACHE:-$work/cache}"
mkdir -p "$cache" "$work/repo/scripts"
# The generators read and write ../.cache relative to the repository.
ln -s "$cache" "$work/.cache"

sha256() {
  "$python" - "$1" <<'PY'
import hashlib, sys
h = hashlib.sha256()
with open(sys.argv[1], 'rb') as f:
    for block in iter(lambda: f.read(1 << 20), b''):
        h.update(block)
print(h.hexdigest())
PY
}

fetch() { # url, path under the cache, sha256
  local url="$1" dest="$cache/$2" expected="$3"
  if [ ! -f "$dest" ]; then
    mkdir -p "$(dirname "$dest")"
    curl -fsSL --retry 3 "$url" -o "$dest.part"
    mv "$dest.part" "$dest"
  fi
  local actual
  actual="$(sha256 "$dest")"
  if [ "$actual" != "$expected" ]; then
    echo "source changed upstream: $url ($actual)" >&2
    exit 1
  fi
}

S3=https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/dem/NCEI_ninth_Topobathy_2014_8483/MA_NH_ME
PTB=https://physionet.org/files/ptbdb/1.0.0/patient122

sources() {
  case "$1" in
    storm)
      fetch https://unidata-nexrad-level2.s3.amazonaws.com/2013/05/19/KDDC/KDDC20130519_000455_V06.gz \
        storm/KDDC20130519_000455_V06.gz bfa70e3e6df82e0e05777123fae519cb95c54a76341af844cec406fde04f0c1b ;;
    water) ;; # computed from IAPWS formulations; nothing to download
    heart)
      fetch "$PTB/s0312lre.hea" ptb/patient122/s0312lre.hea 485c2b887c40d4737a8adf5c0c2eaf099e13894680b83f935012267fe567612e
      fetch "$PTB/s0312lre.dat" ptb/patient122/s0312lre.dat d692724fc7761db8417516d18ee3c33ee366f80321f97c2a7cee8d46a715ddb6
      fetch "$PTB/s0312lre.xyz" ptb/patient122/s0312lre.xyz bad4ec2d78f2c906146486cf91cc1074e6ba28aaf10c4d83e6f0bc532f686b90 ;;
    tides)
      fetch "$S3/ncei19_n45x00_w067x25_2021v1.tif" dem/n45x00_w067x25.tif fa69a6981d1baf89425d69f35358954b727ece15edac15c87f3c5448c39df923
      fetch "$S3/ncei19_n45x00_w067x00_2021v1.tif" dem/n45x00_w067x00.tif 5af5b617e7783196c247a34cf1dd003da82a8ab021b64bda0173469c8aef21e6 ;;
    *) echo "unknown piece: $1 (storm, water, heart, tides)" >&2; exit 2 ;;
  esac
}

generator() {
  case "$1" in
    storm) echo generate_storm.py ;;
    water) echo generate_surface.py ;;
    heart) echo generate_heart.py ;;
    tides) echo generate_tides.py ;;
  esac
}

pieces=("$@")
[ ${#pieces[@]} -eq 0 ] && pieces=(storm water heart tides)

status=0
for piece in "${pieces[@]}"; do
  sources "$piece"
  cp -R "$repo/scripts/$piece" "$work/repo/scripts/"
  (cd "$work/repo" && "$python" -I "scripts/$piece/$(generator "$piece")" > "$work/$piece.log" 2>&1) || {
    echo "$piece: generator failed" >&2
    cat "$work/$piece.log" >&2
    status=1
    continue
  }
  for committed in "$repo/public/data/$piece"/*; do
    name="$(basename "$committed")"
    if cmp -s "$work/repo/public/data/$piece/$name" "$committed"; then
      echo "$piece/$name: reproduced exactly"
    else
      echo "$piece/$name: DIFFERS from the committed copy" >&2
      status=1
    fi
  done
done
exit $status
