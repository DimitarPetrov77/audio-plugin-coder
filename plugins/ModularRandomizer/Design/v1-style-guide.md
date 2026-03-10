# Style Guide v1 — Modular Randomizer

## Design Language
**Ableton Live.** Flat surfaces, muted colors, functional typography. Every pixel earns its place.

---

## Color Palette

### Core
| Token | Hex | Usage |
|:---|:---|:---|
| `--bg-deep` | `#111111` | App background |
| `--bg-surface` | `#1A1A1A` | Panel backgrounds |
| `--bg-elevated` | `#242424` | Cards, cells, inputs |
| `--bg-hover` | `#2A2A2A` | Hover states |
| `--bg-active` | `#333333` | Active/pressed states |

### Text
| Token | Hex | Usage |
|:---|:---|:---|
| `--text-primary` | `#CCCCCC` | Primary labels |
| `--text-secondary` | `#888888` | Secondary info, values |
| `--text-muted` | `#555555` | Disabled, placeholder |

### Accent
| Token | Hex | Usage |
|:---|:---|:---|
| `--accent` | `#FF5500` | Primary accent (Ableton orange) |
| `--accent-hover` | `#FF6E2B` | Accent hover |
| `--accent-muted` | `#FF550033` | Accent at 20% opacity — subtle highlights |

### Semantic
| Token | Hex | Usage |
|:---|:---|:---|
| `--locked` | `#FF3B3B` | Locked parameter indicator |
| `--auto-locked` | `#FF3B3B44` | Auto-detected lock (striped bg) |
| `--connected` | `#FF5500` | Assigned parameter border |
| `--border` | `#2A2A2A` | Default borders |
| `--border-focus` | `#444444` | Focused element borders |

---

## Typography

| Element | Font | Size | Weight | Color |
|:---|:---|:---|:---|:---|
| Plugin title | Inter | 13px | 600 | `--text-primary` |
| Section header | Inter | 11px | 600 | `--text-secondary` |
| Parameter name | Inter | 10px | 500 | `--text-primary` |
| Parameter value | JetBrains Mono | 10px | 400 | `--text-secondary` |
| Button label | Inter | 10px | 600 | `--text-primary` |
| Status bar | JetBrains Mono | 10px | 400 | `--text-muted` |

**Font stack:** `'Inter', system-ui, -apple-system, sans-serif`
**Mono stack:** `'JetBrains Mono', 'SF Mono', 'Consolas', monospace`

---

## Spacing System

Base unit: **4px**

| Token | Value | Usage |
|:---|:---|:---|
| `--space-xs` | 4px | Tight gaps between inline elements |
| `--space-sm` | 8px | Padding inside small components |
| `--space-md` | 12px | Standard padding |
| `--space-lg` | 16px | Panel padding |
| `--space-xl` | 24px | Section gaps |

---

## Component Styles

### Parameter Cell
- Size: 100px × 52px
- Background: `--bg-elevated`
- Border: 1px solid `--border`
- Border-radius: 3px
- Hover: background → `--bg-hover`
- Selected: border → `--accent`, background → `--accent-muted`
- Locked: overlay with `🔒`, background → `--bg-elevated` with diagonal stripe pattern
- Value display: monospace, centered below name

### Logic Block Panel
- Background: `--bg-surface`
- Border: 1px solid `--border`
- Border-radius: 4px
- Padding: `--space-md`
- Header: section title + close button, bottom border

### Toggle Switch (3-way: Manual | Tempo | Audio)
- Background: `--bg-deep`
- Active segment: `--accent` background
- Inactive: `--bg-elevated`
- Border-radius: 2px
- Height: 24px

### Range Slider (dual handle)
- Track: `--bg-deep`, height 4px, rounded
- Active range: `--accent`
- Handle: 12px circle, `--text-primary` fill
- Labels: monospace values at min/max ends

### Fire Button
- Background: `--accent`
- Text: `#FFFFFF`
- Width: 100%
- Height: 32px
- Border-radius: 3px
- Hover: `--accent-hover`
- Active: scale(0.98)

### Target Tags
- Background: `--accent-muted`
- Border: 1px solid `--accent`
- Text: `--accent`
- Padding: 2px 8px
- Border-radius: 2px
- Font-size: 9px
- Includes × remove button

---

## Animation

| Property | Duration | Easing |
|:---|:---|:---|
| Hover transitions | 100ms | ease-out |
| Selection highlight | 150ms | ease-out |
| Fire button pulse | 300ms | ease-out (opacity flash) |
| Panel expand | 200ms | ease-out |

**Rule:** No animation longer than 300ms. No bounce. No spring physics. Instant feedback.

---

## Iconography

- **Lock:** Unicode 🔒 or simple SVG padlock (10px)
- **Close:** × character, `--text-muted`, hover → `--text-primary`
- **Bypass:** ⏻ power symbol
- **Add:** + character in circle
- No icon library dependency. All inline SVG or Unicode.
