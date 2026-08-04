# omezarr-tilesource (vendored)

[OMEZarrTileSource](https://github.com/TissUUmaps/OMEZarrTileSource) — an OpenSeadragon tile
source for OME-Zarr (NGFF).

- **Version:** 0.2.0
- **Published:** 2026-05-25 (per npm registry metadata)
- **Source:** `https://registry.npmjs.org/omezarr-tilesource/-/omezarr-tilesource-0.2.0.tgz`
  (sha1 `2447ab4e94988400e0522bd9fd57d06ccf9fc0bb`, matches the registry's recorded `dist.shasum`)
- **License:** MIT (`LICENSE` in this directory, copied unmodified from the tarball)

`omezarr-tilesource.js` is a **byte-for-byte copy** of `dist/omezarr-tilesource.umd.cjs` from the
tarball above, renamed from `.cjs` to `.js` only — no content edited. The rename avoids
`mime-types` mapping `.cjs` to `application/node` (confirmed locally: `mime.lookup('foo.cjs')` →
`application/node` vs `mime.lookup('foo.js')` → `application/javascript`); `app.js`'s
`express.static` has no MIME overrides, so serving `.cjs` as-is would only work by browser
sniffing and would break under any fronting proxy that adds `X-Content-Type-Options: nosniff`.

The UMD build is self-contained (1.6 MB, zero dynamic imports — all codecs, including zstd and
blosc, are inlined) and self-registering: its last statement is
`globalThis.OpenSeadragon && OMEZarrTileSource.enable(globalThis.OpenSeadragon)`, so loading this
file after OpenSeadragon is present is the entire wiring. No `enable()` call is needed.

Not an npm dependency by design — see
[`docs/osd-decisions.md` D10](../../../../docs/osd-decisions.md#d10--vendor-the-omezarr-tilesource-umd-build-do-not-add-it-as-an-npm-dependency).

To reproduce or update this vendoring:

```bash
curl -sL https://registry.npmjs.org/omezarr-tilesource/-/omezarr-tilesource-<version>.tgz -o omezarr-tilesource.tgz
tar -xzf omezarr-tilesource.tgz
cp package/dist/omezarr-tilesource.umd.cjs app/public/lib/omezarr-tilesource/omezarr-tilesource.js
cp package/LICENSE app/public/lib/omezarr-tilesource/LICENSE
```
