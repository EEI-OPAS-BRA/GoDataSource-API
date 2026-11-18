#!/usr/bin/env bash
# Builds the release artifacts: the pm2 package (API plus compiled interface) and, with --image, the Docker image
# and its image file.
set -Eeuo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: build-artifacts.sh --api-dir <dir> --frontend-dir <dir> --version <v> --out <dir>
                          [--frontend-dist <dir>] [--image] [--image-name <name>] [--revision <sha>]

  --api-dir        API repository; HEAD is packaged
  --frontend-dir   Frontend repository; built with Node 22 unless --frontend-dist is given
  --version        version string, used in file names and as the image tag
  --out            folder that receives godata-<v>.tar.gz, godata-image-<v>.tar.gz and their .sha256 files
  --frontend-dist  an already built interface (the dist folder); skips the Frontend build
  --image          also build and save the Docker image
  --image-name     image name (default ghcr.io/eei-opas-bra/godata)
  --revision       commit recorded in the image (default: HEAD of --api-dir)
USAGE
}

die() {
  printf 'build-artifacts: %s\n' "$*" >&2
  exit 1
}

api_dir="" frontend_dir="" version="" out="" frontend_dist="" image=0
image_name="ghcr.io/eei-opas-bra/godata" revision=""

while (($#)); do
  case "$1" in
    --api-dir | --frontend-dir | --version | --out | --frontend-dist | --image-name | --revision)
      (($# >= 2)) || { usage; die "$1 needs a value"; }
      case "$1" in
        --api-dir) api_dir="$2" ;;
        --frontend-dir) frontend_dir="$2" ;;
        --version) version="$2" ;;
        --out) out="$2" ;;
        --frontend-dist) frontend_dist="$2" ;;
        --image-name) image_name="$2" ;;
        --revision) revision="$2" ;;
      esac
      shift 2
      ;;
    --image)
      image=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$api_dir" && -n "$version" && -n "$out" ]] || { usage; die "--api-dir, --version and --out are required"; }
[[ -n "$frontend_dist" || -n "$frontend_dir" ]] || { usage; die "give --frontend-dir or --frontend-dist"; }
[[ "$version" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || die "invalid version: $version"
[[ -d "$api_dir" ]] || die "no such API directory: $api_dir"
api_dir="$(cd "$api_dir" && pwd)"
git -C "$api_dir" rev-parse --git-dir > /dev/null 2>&1 || die "not a git repository: $api_dir"
[[ -n "$revision" ]] || revision="$(git -C "$api_dir" rev-parse HEAD)"

if [[ -n "$frontend_dist" ]]; then
  [[ -f "$frontend_dist/index.html" ]] || die "no index.html in --frontend-dist: $frontend_dist"
  frontend_dist="$(cd "$frontend_dist" && pwd)"
else
  [[ -f "$frontend_dir/package.json" ]] || die "no package.json in --frontend-dir: $frontend_dir"
  frontend_dir="$(cd "$frontend_dir" && pwd)"
  node_version="$(node -v 2> /dev/null || true)"
  [[ "$node_version" == v22.* ]] || die "the Frontend build needs Node 22, found '${node_version:-no node}'"
fi
if ((image)); then
  docker version > /dev/null 2>&1 || die "docker is not available"
fi

mkdir -p "$out"
out="$(cd "$out" && pwd)"

tmp="$(mktemp -d)"
moved=()
files=()
done_ok=0
cleanup() {
  rm -rf "$tmp"
  if ((!done_ok)); then
    ((${#moved[@]} == 0)) || rm -f "${moved[@]}"
    for f in "${files[@]}"; do rm -f "$out/.$f.partial"; done
  fi
}
trap cleanup EXIT

if [[ -z "$frontend_dist" ]]; then
  echo "building the Frontend in $frontend_dir" >&2
  (cd "$frontend_dir" && npm ci --no-audit --no-fund && npm run build)
  [[ -f "$frontend_dir/dist/index.html" ]] || die "the Frontend build did not produce dist/index.html"
  frontend_dist="$frontend_dir/dist"
fi

pkg="godata-$version"
tree="$tmp/$pkg"
mkdir -p "$tree"
git -C "$api_dir" archive HEAD | tar -x -C "$tree"
rm -rf "$tree/local" "$tree/.github" "$tree/client/dist"
mkdir -p "$tree/client" "$tree/deploy/defaults"
cp -a "$frontend_dist" "$tree/client/dist"
cp "$tree/server/config.json" "$tree/server/datasources.json" "$tree/deploy/defaults/"
# Gitignored, so absent from the archive; without it no scheduled routine runs on pm2
echo '{}' > "$tree/server/boot/scheduler.json"

files+=("$pkg.tar.gz")
tar -C "$tmp" -czf "$tmp/$pkg.tar.gz" "$pkg"
(cd "$tmp" && sha256sum "$pkg.tar.gz" > "$pkg.tar.gz.sha256")
files+=("$pkg.tar.gz.sha256")

if ((image)); then
  image_file="godata-image-$version.tar.gz"
  docker build -f "$tree/deploy/docker/Dockerfile" \
    --build-arg "GODATA_VERSION=$version" --build-arg "GODATA_REVISION=$revision" \
    -t "$image_name:$version" "$tree"
  docker save "$image_name:$version" | gzip > "$tmp/$image_file"
  (cd "$tmp" && sha256sum "$image_file" > "$image_file.sha256")
  files+=("$image_file" "$image_file.sha256")
fi

# Copy under a hidden name first so a failed copy never leaves a half-written artifact
for f in "${files[@]}"; do
  moved+=("$out/.$f.partial")
  mv "$tmp/$f" "$out/.$f.partial"
done
moved=()
for f in "${files[@]}"; do
  moved+=("$out/$f")
  mv "$out/.$f.partial" "$out/$f"
done
done_ok=1

printf 'artifacts written to %s:\n' "$out" >&2
printf '  %s\n' "${files[@]}" >&2
