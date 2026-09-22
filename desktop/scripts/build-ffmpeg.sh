#!/bin/sh
# The ffmpeg the Mac app ships, built here from source with only what the app calls for. The npm build the app used
# to bundle (ffmpeg-static) was 45 MB of every codec ffmpeg has — x265, AV1, VP9, VMAF, Blu-ray, libass — and was
# configured --enable-gpl --enable-nonfree, which ffmpeg's own licence page says may not be redistributed. This one
# is about a tenth of the size and LGPL: no GPL component, the only external library is LAME (LGPL 2.0), because
# macOS has no MP3 encoder and the recorder writes MP3 (core/recorder.js).
#
# What the app asks of ffmpeg, and so what is enabled (every name checked against ffmpeg 9.0's configure):
#   core/recorder.js        s16le on stdin → libmp3lame → mp3 on stdout        (encoder libmp3lame, muxer mp3)
#   desktop/lib/capture.js  avfoundation microphone → aresample → s16le      (indev avfoundation, encoder pcm_s16le) — the
#                           fallback when the Swift capture helper cannot be built; also `-list_devices`
#   desktop/lib/mp4.js      `-i file` for the duration; PNG frames via ffconcat + the MP3 → H.264/AAC MP4
#                           (demuxers concat, image2, png_pipe; decoder png; encoders h264_videotoolbox, aac; muxer mp4;
#                           filters fps, format, scale)
#   desktop/lib/uploads.js  a user's video → its audio stream copied into .m4a, or re-encoded to AAC when the container
#                           cannot hold it (the container demuxers and audio decoders people's files come with; muxer ipod)
# Anything else — subtitle burn-in, ffprobe, video decoding — happens on the server, whose ffmpeg is the distribution's.
#
# The result is cached under ~/.cache/seesubtitles keyed by the hash of this file, so a change here is a new build
# and an unchanged script is a copy. scripts/build-helpers.js runs this when the cache is empty and copies the binary
# into resources/bin. Run it by hand to rebuild: sh desktop/scripts/build-ffmpeg.sh [--force]
#
# Sizes measured on 2026-09-22 (Apple M-series, Xcode 27): ffmpeg-static 45.6 MB → this build see build.log in the cache.
set -eu

FFMPEG_VERSION=9.0.2
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
LAME_VERSION=4.0
LAME_SHA256=3df5124d5ad3a98312ffd7ba6a9b36230e4f8a3e66d3ce0f425e336c32d216eb
MIN_MACOS=13.0   # LSMinimumSystemVersion in desktop/electron-builder.yml

HERE=$(cd "$(dirname "$0")" && pwd)
KEY=$(shasum -a 256 "$HERE/build-ffmpeg.sh" | cut -c1-12)
CACHE_ROOT="${SEESUBTITLES_CACHE:-$HOME/.cache/seesubtitles}"
CACHE="$CACHE_ROOT/ffmpeg-$FFMPEG_VERSION-lame-$LAME_VERSION-$KEY"
# the downloads are shared by every build: an edit to this script means a rebuild, not a second download (the link
# to SourceForge from mainland China resets connections often enough that a second one can fail)
DOWNLOADS="$CACHE_ROOT/downloads"
if [ -x "$CACHE/ffmpeg" ] && [ "${1:-}" != "--force" ]; then echo "$CACHE/ffmpeg"; exit 0; fi

[ "$(uname -m)" = arm64 ] || { echo "✖ this builds the arm64 binary the app ships; run it on Apple silicon" >&2; exit 1; }
for tool in clang make curl shasum otool; do command -v "$tool" >/dev/null || { echo "✖ $tool is missing (xcode-select --install)" >&2; exit 1; }; done

SRC="$CACHE/src"; LAME="$CACHE/lame"; OUT="$CACHE/out"; LOG="$CACHE/build.log"
mkdir -p "$SRC" "$DOWNLOADS"
: > "$LOG"
JOBS=$(sysctl -n hw.ncpu)
FLAGS="-arch arm64 -mmacosx-version-min=$MIN_MACOS"
say() { echo "── $*"; echo "── $*" >> "$LOG"; }

fetch() { # fetch <url> <sha256> <file> — into the shared downloads folder, checked, then linked into this build
  if [ ! -f "$DOWNLOADS/$3" ] || ! echo "$2  $DOWNLOADS/$3" | shasum -a 256 -c --status; then
    say "downloading $3"
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -o "$DOWNLOADS/$3.part" "$1" && mv "$DOWNLOADS/$3.part" "$DOWNLOADS/$3"
    echo "$2  $DOWNLOADS/$3" | shasum -a 256 -c --status || { echo "✖ $3 does not match its published checksum" >&2; exit 1; }
  fi
  ln -sf "$DOWNLOADS/$3" "$SRC/$3"
}
fetch "https://downloads.sourceforge.net/project/lame/lame/$LAME_VERSION/lame-$LAME_VERSION.tar.gz" "$LAME_SHA256" "lame-$LAME_VERSION.tar.gz"
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "$FFMPEG_SHA256" "ffmpeg-$FFMPEG_VERSION.tar.xz"

say "LAME $LAME_VERSION (static, arm64, macOS ≥ $MIN_MACOS)"
rm -rf "$SRC/lame-$LAME_VERSION" "$LAME"
tar -xzf "$SRC/lame-$LAME_VERSION.tar.gz" -C "$SRC"
( cd "$SRC/lame-$LAME_VERSION" \
  && ./configure --prefix="$LAME" --disable-shared --enable-static --disable-frontend --disable-decoder --disable-gtktest \
       --disable-dependency-tracking CC=clang CFLAGS="$FLAGS -O2" LDFLAGS="$FLAGS" >> "$LOG" 2>&1 \
  && make -j"$JOBS" >> "$LOG" 2>&1 && make install >> "$LOG" 2>&1 ) || { echo "✖ LAME did not build — $LOG" >&2; exit 1; }

say "ffmpeg $FFMPEG_VERSION (only the app's components)"
rm -rf "$SRC/ffmpeg-$FFMPEG_VERSION" "$OUT"
tar -xJf "$SRC/ffmpeg-$FFMPEG_VERSION.tar.xz" -C "$SRC"
( cd "$SRC/ffmpeg-$FFMPEG_VERSION" && ./configure --prefix="$OUT" --arch=arm64 --cc=clang \
    --extra-cflags="$FLAGS -O2 -I$LAME/include" --extra-ldflags="$FLAGS -L$LAME/lib" --extra-version=seesubtitles \
    --disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug \
    --disable-ffplay --disable-ffprobe \
    --enable-zlib --enable-avfoundation --enable-videotoolbox --enable-libmp3lame \
    --enable-indev=avfoundation \
    --enable-encoder=libmp3lame,aac,h264_videotoolbox,pcm_s16le \
    --enable-decoder=png,mp3float,mp3,mp2float,aac,aac_latm,ac3,eac3,dca,truehd,opus,vorbis,flac,alac,wmav1,wmav2,wmapro,adpcm_ima_wav,adpcm_ms,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_f32le,pcm_f32be,pcm_u8,pcm_alaw,pcm_mulaw \
    --enable-parser=png,aac,aac_latm,mpegaudio,ac3,dca,flac,opus,vorbis,h264,hevc,mpeg4video,mpegvideo,vp9,av1 \
    --enable-demuxer=concat,image2,image_png_pipe,pcm_s16le,mov,matroska,avi,mpegts,mpegps,flv,ogg,flac,wav,aiff,aac,mp3,asf,caf \
    --enable-muxer=mp4,ipod,mp3,pcm_s16le,null \
    --enable-filter=aresample,fps,format,scale \
    --enable-protocol=file,pipe >> "$LOG" 2>&1 \
  && make -j"$JOBS" >> "$LOG" 2>&1 && make install >> "$LOG" 2>&1 ) || { echo "✖ ffmpeg did not build — $LOG (configure's own log: $SRC/ffmpeg-$FFMPEG_VERSION/ffbuild/config.log)" >&2; exit 1; }

BIN="$OUT/bin/ffmpeg"
say "checking the binary"
fail() { echo "✖ $*" >&2; exit 1; }
file -b "$BIN" | grep -q 'arm64' || fail "not an arm64 build: $(file -b "$BIN")"
otool -L "$BIN" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/Frameworks/)' | grep . && fail "links libraries outside the system: see above"
"$BIN" -version | grep -q -- '--enable-gpl' && fail "built with --enable-gpl"
"$BIN" -version | grep -q -- '--enable-nonfree' && fail "built with --enable-nonfree"
for enc in libmp3lame aac h264_videotoolbox pcm_s16le; do "$BIN" -hide_banner -encoders | grep -q " $enc " || fail "encoder $enc is missing"; done
for dem in concat image2 png_pipe mov matroska mp3 wav; do "$BIN" -hide_banner -demuxers | grep -qE " ($dem|[a-z0-9_,]*,$dem)(,| )" || fail "demuxer $dem is missing"; done
"$BIN" -hide_banner -devices | grep -q avfoundation || fail "the avfoundation input device is missing"
for f in aresample fps format scale; do "$BIN" -hide_banner -filters | grep -qE " $f +" || fail "filter $f is missing"; done
cp "$BIN" "$CACHE/ffmpeg"; chmod 755 "$CACHE/ffmpeg"
"$CACHE/ffmpeg" -hide_banner -buildconf > "$CACHE/ffmpeg.buildconf"
rm -rf "$SRC/lame-$LAME_VERSION" "$SRC/ffmpeg-$FFMPEG_VERSION" "$OUT"
say "ffmpeg $FFMPEG_VERSION + LAME $LAME_VERSION: $(du -h "$CACHE/ffmpeg" | cut -f1 | tr -d ' ') at $CACHE/ffmpeg"
echo "$CACHE/ffmpeg"
