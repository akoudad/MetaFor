# Screen guidance

Help highlights use a cyan edge, a dark contrast line, and a soft halo. The dark line keeps the target visible on bright pages; the halo separates it from dark backgrounds. Rectangle interiors stay transparent, and marks never intercept clicks.

Both line layers use identical source geometry and fixed screen-space stroke widths. Labels retain their existing placement rules: avoid target regions, other labels, and the actual Help window. When the Help panel moves or changes size, label placement updates without moving the highlighted source coordinates. Invalid layout updates clear the overlay. The overlay fades in once; reduced-motion settings disable the fade.

The overlay refreshes its actual native content bounds when it is shown, moved, resized, or read by the renderer. This accounts for macOS repositioning the window after creation without changing the captured source coordinates.

The full-display guidance window disables rounded corners and enables placement beyond the work area. Without these native window options, macOS moved the transparent window below the menu bar: a requested origin of `(0, 0)` became `(0, 33)` on the tested Retina display. The native Electron probe reproduced the shift and verified that the corrected window stays at `(0, 0)`. Coordinates remain derived from the captured display; no fixed menu-bar offset is applied.
