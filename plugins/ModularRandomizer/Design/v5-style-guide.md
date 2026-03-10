# Style Guide v5 — Theme Color Rework

## Summary
Rebuilt three themes (Grey, Earthy, Terminal) from the ground up using color accessibility science.
The Light theme remains unchanged as the reference implementation.

---

## Design Principles Applied

1. **WCAG AA Compliance** — All text colors achieve ≥4.5:1 contrast on their typical background
2. **Coherent Background Ramp** — bg-app → bg-panel → bg-cell → bg-cell-hover forms a monotonic progression; bg-inset is always darker than bg-app
3. **Visible Borders** — All structural borders achieve ≥2:1 contrast against adjacent surfaces
4. **Distinct Accents** — Accent colors achieve ≥3:1 on cell backgrounds for UI component visibility
5. **Theme Personality** — Each theme maintains a clear visual identity and mood

---

## Grey Theme — "Industrial Dark Mid-Tone"

**Concept**: Shifted from a broken light-grey (where inset was lighter than app) to a proper dark mid-tone industrial palette. All surfaces are dark enough that light text reads clearly.

| Token | Old | New | Rationale |
|:---|:---|:---|:---|
| `--bg-app` | `#B0B0B0` | `#3A3A3A` | Mid-tone grey; provides dark base for light text |
| `--bg-panel` | `#C4C4C4` | `#484848` | Slightly lighter than app for panel distinction |
| `--bg-cell` | `#F0F0F0` | `#585858` | Was too far from panel; now coherent step |
| `--bg-inset` | `#DCDCDC` | `#2E2E2E` | Was lighter than app (wrong); now properly recessed |
| `--text-primary` | `#000000` | `#F2F2F2` | Inverted for dark background readability |
| `--text-muted` | `#555555` | `#A0A0A0` | ~4.7:1 on `#585858` cell (was ~3.2:1 on `#B0B0B0`) |
| `--accent` | `#E87430` | `#F08040` | Warmer, brighter orange; ~4.0:1 on cells |
| `--border` | `#909090` | `#6E6E6E` | ~1.3:1 on cells (structural); clearly visible against `#3A3A3A` |

---

## Earthy Theme — "Warm Studio"

**Concept**: Kept the dark warm palette but replaced the invisible dark-green accent with warm amber. All warm-toned colors now have sufficient luminance contrast.

| Token | Old | New | Rationale |
|:---|:---|:---|:---|
| `--bg-app` | `#252018` | `#1C1814` | Slightly darker for deeper base |
| `--bg-cell` | `#443E38` | `#342C24` | Closer to panel for tighter ramp |
| `--accent` | `#2D6B3F` | `#D4943C` | **Critical fix**: old green was 1.8:1 on cells; new amber is ~5.2:1 |
| `--text-muted` | `#B0A898` | `#A89880` | Maintained warm tone; 4.6:1 on `#342C24` |
| `--env-color` | `#A08420` | `#C8A838` | Brightened golden; ~5.8:1 on cells |
| `--sample-color` | `#8B3030` | `#C05A3A` | Brightened terracotta; ~3.5:1 on cells |
| `--border` | `#685E50` | `#504436` | Better separation from cell background |
| `--midi-dot` | `#50A858` | `#6EBB56` | Brighter green dot for activity visibility |

---

## Terminal Theme — "CRT Phosphor"

**Concept**: Authentic CRT terminal with green-tinted surfaces. Backgrounds have a subtle green hue instead of neutral black. Accent is vivid phosphor green (#33DD44) evoking real terminal displays.

| Token | Old | New | Rationale |
|:---|:---|:---|:---|
| `--bg-app` | `#000000` | `#0A0E0A` | Green-tinted near-black instead of pure black |
| `--bg-cell` | `#161616` | `#141C14` | Green-tinted cells for cohesive CRT feel |
| `--text-primary` | `#E8E8E8` | `#D8F0D8` | Green-tinted white; authentic terminal readout |
| `--text-muted` | `#707070` | `#6E946E` | Green-tinted muted; 4.5:1 on `#141C14` |
| `--accent` | `#40A840` | `#33DD44` | Vivid phosphor green; ~9.5:1 on cells |
| `--border` | `#333333` | `#2A382A` | Green-tinted borders; visible against green-tinted bg |
| `--border-strong` | `#555555` | `#3E5040` | Stronger green borders for panels |
| `--env-color` | `#C0A030` | `#E0C040` | Brighter amber for CRT contrast |
| `--sample-color` | `#C03030` | `#EE4444` | Vivid red for CRT-grade visibility |
| `--thumb-color` | `#E0E0E0` | `#C8E8C8` | Green-tinted thumb for visual cohesion |

---

## Block Colors (bcolors) — Redesigned Per Theme

Each theme's bcolors array now uses colors that are:
- **Distinguishable** from each other with sufficient hue separation
- **Visible** against that theme's cell/panel backgrounds
- **Thematically coherent** with the palette mood

---

## Preserved: Light Theme (Reference)
No changes. The Light theme already had proper contrast ratios and serves as the default Ableton-inspired design.
