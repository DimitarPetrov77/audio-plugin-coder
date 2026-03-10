# Style Guide v2 — Modular Randomizer

## Design Language
**Light greyscale.** Paper-like, clean, professional. The only color is orange — used sparingly for active states, selections, and the fire button. Everything else is grey.

Inspiration: Ableton Live light theme, macOS system preferences, Figma's UI.

---

## Color Palette

### Surfaces
| Token | Hex | Usage |
|:---|:---|:---|
| `--bg-app` | `#F0F0F0` | App background |
| `--bg-panel` | `#FAFAFA` | Panel/card backgrounds |
| `--bg-cell` | `#FFFFFF` | Parameter cells, inputs |
| `--bg-cell-hover` | `#F5F5F5` | Cell hover state |
| `--bg-cell-active` | `#EDEDED` | Cell pressed state |
| `--bg-inset` | `#E8E8E8` | Slider tracks, inset areas |

### Borders
| Token | Hex | Usage |
|:---|:---|:---|
| `--border` | `#DEDEDE` | Default borders |
| `--border-strong` | `#C0C0C0` | Panel dividers, headers |
| `--border-focus` | `#999999` | Focused elements |

### Text
| Token | Hex | Usage |
|:---|:---|:---|
| `--text-primary` | `#333333` | Labels, names |
| `--text-secondary` | `#777777` | Values, secondary info |
| `--text-muted` | `#AAAAAA` | Disabled, placeholders |
| `--text-inverse` | `#FFFFFF` | Text on accent backgrounds |

### Accent (the only color)
| Token | Hex | Usage |
|:---|:---|:---|
| `--accent` | `#FF5500` | Primary accent |
| `--accent-hover` | `#E64D00` | Accent hover (darker) |
| `--accent-light` | `#FFF0E6` | Selected cell background |
| `--accent-border` | `#FFB380` | Selected cell border |

### Semantic
| Token | Hex | Usage |
|:---|:---|:---|
| `--locked-bg` | `#FFF0F0` | Locked cell background |
| `--locked-border` | `#FFCCCC` | Locked cell border |
| `--locked-icon` | `#CC3333` | Lock icon color |
| `--auto-lock-bg` | `#FFF5E6` | Auto-detected lock cell |
| `--auto-lock-border` | `#FFD699` | Auto-detected lock border |
| `--midi-dot` | `#33CC33` | MIDI activity indicator |

---

## Typography

| Element | Font | Size | Weight | Color |
|:---|:---|:---|:---|:---|
| Plugin title | Inter | 13px | 600 | `--text-primary` |
| Section header | Inter | 10px | 600 | `--text-secondary` |
| Parameter name | Inter | 10px | 500 | `--text-primary` |
| Parameter value | JetBrains Mono | 10px | 400 | `--text-secondary` |
| Button label | Inter | 10px | 600 | `--text-inverse` (on accent) |
| Block title | Inter | 11px | 600 | `--text-primary` |
| Block summary | Inter | 10px | 400 | `--text-secondary` |
| Status bar | JetBrains Mono | 10px | 400 | `--text-muted` |
| MIDI note label | JetBrains Mono | 10px | 500 | `--text-primary` |

**Font stack:** `'Inter', system-ui, -apple-system, sans-serif`
**Mono stack:** `'JetBrains Mono', 'SF Mono', 'Consolas', monospace`

---

## Spacing

Base unit: **4px**

| Token | Value |
|:---|:---|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 12px |
| `--space-lg` | 16px |
| `--space-xl` | 24px |

---

## Component Styles

### Parameter Cell
- Size: flexible, min 96px wide × 52px tall
- Background: `--bg-cell` (white)
- Border: 1px solid `--border`
- Border-radius: 3px
- **Hover**: bg → `--bg-cell-hover`
- **Selected**: bg → `--accent-light`, border → `--accent-border`
- **Locked**: bg → `--locked-bg`, border → `--locked-border`, lock icon visible
- **Auto-locked**: bg → `--auto-lock-bg`, border → `--auto-lock-border`, ⚠ icon
- Shadow: none

### Logic Block Card
- Background: `--bg-panel`
- Border: 1px solid `--border`
- Border-radius: 4px
- **Active block**: left border 3px solid `--accent`
- **Collapsed**: single row showing summary
- **Expanded**: all controls visible

### Segmented Control
- Background: `--bg-inset`
- Active segment: `--accent` bg, white text
- Inactive: transparent bg, `--text-secondary`
- Border-radius: 3px
- Height: 26px

### Slider
- Track: `--bg-inset`, height 4px, rounded
- Filled portion: `--accent`
- Handle: 12px circle, white fill, 1px `--border-strong` stroke
- Labels: mono, `--text-secondary`

### Fire Button
- Background: `--accent`
- Text: white, 11px, 600 weight
- Full width of block
- Height: 30px
- Border-radius: 3px
- Hover: `--accent-hover`
- Active: slight scale (0.98)
- No shadow

### Target Tags
- Background: `--accent-light`
- Border: 1px solid `--accent-border`
- Text: `--accent`, 9px, 500 weight
- Padding: 2px 8px
- × button to remove

### Toggle Switch
- Track: `--bg-inset`, 28×14px, 1px `--border`
- Thumb: white, 10px circle, subtle shadow
- On: track → `--accent`, thumb slides right

---

## Animation

| Property | Duration | Easing |
|:---|:---|:---|
| Hover | 80ms | ease-out |
| Selection | 120ms | ease-out |
| Fire flash | 250ms | ease-out |
| Block expand/collapse | 200ms | ease-out |
| Slider thumb | 0ms | immediate (no animation on drag) |

**Rule:** Minimal animation. Functional only. No decorative motion.
