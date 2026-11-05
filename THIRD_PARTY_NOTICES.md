# Third-party notices

Life OS itself is under the [MIT License](LICENSE). It's built with open-source software that keeps its own licences.

## Bundled fonts

Both fonts are under the SIL Open Font License 1.1. Their full licence texts ship inside the app and are in [`public/licenses`](public/licenses).

- **Inter:** [`inter-OFL.txt`](public/licenses/inter-OFL.txt)
- **Vazirmatn:** [`vazirmatn-OFL.txt`](public/licenses/vazirmatn-OFL.txt)

## Libraries

- **JavaScript:** mostly MIT, ISC and Apache-2.0 (React, Tauri API, Anthropic SDK, zustand, zod, sql.js, dnd-kit, lucide). Each package's licence is in its folder after `npm install`.
- **Rust:** mostly MIT or Apache-2.0 (Tauri, rusqlite and their dependencies). A few build dependencies, such as `cssparser` and `selectors`, are under MPL-2.0 and used unmodified.

## Local AI assistant

- **llama.cpp** (MIT), compiled into the Windows app as the model engine.
- **Qwen3.5 models** (Apache-2.0) are downloaded separately at the user's request and aren't part of this repository or the installers.
