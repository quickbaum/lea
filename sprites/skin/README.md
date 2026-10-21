Skin masks in ANNY's (MakeHuman hm08) UV layout, 512x512, built from the anny package:

- masks_a.png: R = lips, G = eyelids, B = face (blush). From MPFB2's skin masks (CC0).
- masks_b.png: R = ears, G = finger + toe nails, B = regions
  (255 iris front, 200 eyeball back, 150 eye cavity, 100 mouth, 60 tongue).
  The regions come from ANNY's body_parts_segmentation.png (Apache-2.0, NAVER Corp.).

Painted into a per-character skin by js/skin.js.
- eyes.json: each eyeball's apex in the 1024 UV frame and its texel density
  (px per metre). The eyeballs are mapped at ~1/10 of the face's density, so the
  iris is painted at true size (~3 px) at the apex, not across the mask's island.
