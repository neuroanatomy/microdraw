#!/bin/bash

diff_dir="diff"
mkdir -p $diff_dir
rm $diff_dir/*

for img in e2e/screenshots/*.png; do
    ref_img=reference-screenshots/${img##*/}
    diff_img=diff/${img##*/}
    magick "$img" "$ref_img" "$diff_img"
    magick compare "$img" "$ref_img" "$diff_img"
done
    
