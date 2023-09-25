#!/bin/bash

img_dir=e2e/screenshots
ref_dir=reference-screenshots
diff_dir="diff"

mkdir -p $diff_dir
rm $diff_dir/*

for img in "$img_dir"/*.png; do
    ref_img=$ref_dir/${img##*/}
    diff_img=$diff_dir/${img##*/}
    magick "$img" "$ref_img" "$diff_img"
    magick compare "$img" "$ref_img" "$diff_img"
done
    
