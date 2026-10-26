#!/usr/bin/env bash
# Reruns generate_storm.py in a scratch copy of the repo layout and checks that
# it reproduces the committed storm.json and storm.bin exactly. The NEXRAD file
# (about 11 MB) is downloaded from NOAA's public bucket into the scratch copy.
#
#   python -m pip install -r scripts/storm/requirements.txt
#   scripts/storm/check_reproducible.sh
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
python="${PYTHON:-python3}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/repo/scripts/storm"
cp "$repo/scripts/storm/generate_storm.py" "$work/repo/scripts/storm/"
(cd "$work/repo" && "$python" -I scripts/storm/generate_storm.py > /dev/null)

# The source file the scan was made from.
expected_source=bfa70e3e6df82e0e05777123fae519cb95c54a76341af844cec406fde04f0c1b
actual_source="$("$python" -c 'import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$work/.cache/storm/KDDC20130519_000455_V06.gz")"
if [ "$actual_source" != "$expected_source" ]; then
  echo "NEXRAD source changed: $actual_source" >&2
  exit 1
fi

status=0
for file in storm.json storm.bin; do
  if cmp -s "$work/repo/public/data/storm/$file" "$repo/public/data/storm/$file"; then
    echo "$file: reproduced exactly"
  else
    echo "$file: DIFFERS from the committed copy" >&2
    status=1
  fi
done
exit $status
