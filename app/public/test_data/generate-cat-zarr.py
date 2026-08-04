#!/usr/bin/env python3
"""Generate app/public/test_data/cat.zarr, the OME-Zarr e2e fixture for Z3.

Stitches the existing DeepZoom cat tiles (cat_files/9/*.jpeg, the deepest/full-res level
of cat.dzi, 480x360) into a single grayscale image, derives 3 synthetic z-planes from it
(original / horizontally flipped / inverted), and writes them as a 3-level multiscale
OME-Zarr pyramid with axes [z, y, x]. No color channel axis is used: omezarr-tilesource
defaults an axis-less array to a single white/grayscale channel with auto min/max
windowing (verified by reading its bundled renderer, `Fi`/`Zi` in
app/public/lib/omezarr-tilesource/omezarr-tilesource.js) so this is compliant, not a
simplification that breaks rendering.

Written as NGFF **v0.5 / Zarr storage format 3** ("zarr.json", chunk keys like "c/0/0/0"),
not the more common v0.4/Zarr-v2 layout ("`.zattrs`/`.zarray`/`.zgroup`", chunk keys like
"0.0.0") -- deliberately, not by default. Express's static middleware
(`app.use(express.static(...))` in app/app.js, no `dotfiles` option given) uses the
default `dotfiles: 'ignore'`, which 404s any path with a dot-prefixed segment. That would
make every v0.4 metadata file unservable. Zarr v3's file names have no leading dot, so this
sidesteps the problem instead of changing Express's static-file config (out of scope for
this fixture). Confirmed omezarr-tilesource reads v3 fine: its `fr()` open helper
(vendored bundle) already tries v2 first and falls back to v3 automatically, and its
`_getMultiscale` unwraps an `"ome"` attributes key before looking for `multiscales`, which
is exactly the v0.5 shape.

Reproduce with:
    python3 -m venv /tmp/zarrenv && source /tmp/zarrenv/bin/activate
    pip install zarr==3.3.0 numpy==2.2.6 pillow==11.1.0
    python3 app/public/test_data/generate-cat-zarr.py

Run from the repository root (relies on relative paths below).
"""
import numpy as np
from PIL import Image
import zarr

SRC_DIR = "app/public/test_data/cat_files/9"
OUT_DIR = "app/public/test_data/cat.zarr"
OVERLAP = 1
WIDTH = 480
HEIGHT = 360


def stitch_level9():
    """Reassemble the full-res image from DeepZoom tiles, dropping the 1px overlap."""
    canvas = Image.new("L", (WIDTH, HEIGHT))
    for col, x0, x1 in ((0, 0, 256), (1, 256, 480)):
        for row, y0, y1 in ((0, 0, 256), (1, 256, 360)):
            tile = Image.open(f"{SRC_DIR}/{col}_{row}.jpeg").convert("L")
            crop_x0 = OVERLAP if col > 0 else 0
            crop_y0 = OVERLAP if row > 0 else 0
            crop = tile.crop((crop_x0, crop_y0, crop_x0 + (x1 - x0), crop_y0 + (y1 - y0)))
            canvas.paste(crop, (x0, y0))
    return np.array(canvas, dtype=np.uint8)


def build_z_stack(level0_img):
    z0 = level0_img
    z1 = np.fliplr(level0_img)
    z2 = 255 - level0_img
    return np.stack([z0, z1, z2], axis=0)  # (z, y, x)


def downsample(stack, factor):
    out = []
    for i in range(stack.shape[0]):
        im = Image.fromarray(stack[i])
        w, h = im.width // factor, im.height // factor
        out.append(np.array(im.resize((w, h), Image.LANCZOS), dtype=np.uint8))
    return np.stack(out, axis=0)


def main():
    level0 = build_z_stack(stitch_level9())
    level1 = downsample(level0, 2)
    level2 = downsample(level1, 2)
    levels = [level0, level1, level2]

    root = zarr.open_group(OUT_DIR, mode="w", zarr_format=3)
    for i, arr in enumerate(levels):
        nz, ny, nx = arr.shape
        chunk_y = min(ny, 180)
        chunk_x = min(nx, 240)
        root.create_array(
            str(i),
            data=arr,
            chunks=(1, chunk_y, chunk_x),
            compressors=None,
        )

    root.attrs["ome"] = {
        "version": "0.5",
        "multiscales": [{
            "name": "cat",
            "axes": [
                {"name": "z", "type": "space"},
                {"name": "y", "type": "space", "unit": "micrometer"},
                {"name": "x", "type": "space", "unit": "micrometer"},
            ],
            "datasets": [
                {
                    "path": str(i),
                    "coordinateTransformations": [
                        {"type": "scale", "scale": [1.0, float(2 ** i), float(2 ** i)]}
                    ],
                }
                for i in range(len(levels))
            ],
        }],
    }

    print(f"wrote {OUT_DIR}: levels {[list(a.shape) for a in levels]}")


if __name__ == "__main__":
    main()
