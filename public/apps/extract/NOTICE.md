# Archive extractor — provenance and licences

Client-side archive extraction. Nothing is uploaded: the file is read in the
browser, unpacked in a Web Worker, and the results are handed back as
downloads. There is no server side to this tool.

## What is bundled here

| File | Source | Licence |
|---|---|---|
| `vendor/libarchive.wasm` | [libarchive](https://www.libarchive.org/) compiled to WebAssembly | BSD-2-Clause |
| `vendor/libarchive.js`, `vendor/libarchive-loader.js` | [libarchive.js](https://github.com/nika-begiashvili/libarchivejs) | MIT |
| `vendor/worker-bundle.js` | libarchive.js worker, bundling [Comlink](https://github.com/GoogleChromeLabs/comlink) | MIT / Apache-2.0 (Comlink, © Google LLC) |
| `vendor/zip-fs.min.js` | [zip.js](https://github.com/gildas-lormeau/zip.js) | BSD-3-Clause |
| `common.js`, `extractor.js`, `index.html` | written for ExeBrowser | part of this site |

libarchive is what does the actual work, and it is the same library behind
`bsdtar` and a great many archive tools. It reads 7z, ZIP, RAR, TAR, gzip,
bzip2, xz, ISO and more.

## Why this exists alongside /run/7-zip/

`/run/7-zip/` runs the genuine 7-Zip *program* under Wine, which means booting
a 47.7 MB runtime before you can open anything. That is the right tool if you
want 7-Zip's own interface or its exact behaviour. For the ordinary case —
"I have an archive, get the files out" — this page does the same job with a
1.2 MB download and no emulation.

Both are honest about which they are, and each links to the other.
