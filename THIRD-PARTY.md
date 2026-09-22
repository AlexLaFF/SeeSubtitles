# Third-party software in the Mac app

See Subtitles is MIT (LICENSE). The Mac app bundle also carries these, as separate executables and files, under
their own licences:

| What | Where in the bundle | Licence | Source |
|---|---|---|---|
| **FFmpeg** 9.0.2, built by `desktop/scripts/build-ffmpeg.sh` with only the components the app calls and **no GPL or non-free component** | `Contents/Resources/bin/ffmpeg` | LGPL 2.1 or later | https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz |
| **LAME** 4.0, the MP3 encoder linked into that ffmpeg (macOS has none of its own) | inside `bin/ffmpeg` | LGPL 2.0 or later | https://sourceforge.net/projects/lame/files/lame/4.0/ |
| **Electron** and Chromium | `Contents/Frameworks` | MIT and BSD-style | https://github.com/electron/electron |
| **electron-updater** | `app.asar` | MIT | https://github.com/electron-userland/electron-builder |
| **ws** | `app.asar` | MIT | https://github.com/websockets/ws |
| **qrcode.js** | `Resources/web/vendor/qrcode.js` | MIT | https://github.com/davidshimjs/qrcodejs |
| **Instrument Sans** and **Instrument Serif** | `Resources/web/fonts` | SIL Open Font License 1.1 (`web/fonts/OFL-*.txt`) | https://github.com/Instrument/instrument-sans |

The LGPL asks that anyone receiving the binary can obtain its source and rebuild it: the exact configure line, the
pinned tarballs and their checksums are the build script above, and `ffmpeg -buildconf` in the bundle prints the
configuration it was made with. The iPhone app carries none of these: it records AAC with the system's encoder and
draws its MP4 with AVFoundation.
