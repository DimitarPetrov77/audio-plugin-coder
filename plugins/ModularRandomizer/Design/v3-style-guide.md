# Style Guide v3 — Modular Randomizer

## Design Language
**Light greyscale.** Paper-like, clean, professional. Two accent colors only:
- **Orange** (`#FF5500`) — selections, active states, fire button, randomize controls
- **Blue** (`#22AAFF`) — envelope follower mode, ENV indicator, level meter

Inspiration: Ableton Live's Session View. Functional over decorative. Every pixel earns its space.

---

## Color Palette

### Greyscale
| Token | Hex | Usage |
|:---|:---|:---|
| `--bg-app` | `#F0F0F0` | Application background |
| `--bg-panel` | `#FAFAFA` | Header, section bars, status bar |
| `--bg-cell` | `#FFFFFF` | Parameter cells, block cards, inputs |
| `--bg-cell-hover` | `#F5F5F5` | Hover state |
| `--bg-inset` | `#E8E8E8` | Slider tracks, segmented control bg, target boxes |
| `--border` | `#DEDEDE` | Default borders |
| `--border-strong` | `#C0C0C0` | Separator lines, slider thumbs |
| `--border-focus` | `#999999` | Hover/focus borders |

### Text
| Token | Hex | Usage |
|:---|:---|:---|
| `--text-primary` | `#333333` | Main text |
| `--text-secondary` | `#777777` | Values, descriptions |
| `--text-muted` | `#AAAAAA` | Labels, placeholders, section titles |
| `--text-inverse` | `#FFFFFF` | Text on accent backgrounds |

### Accent — Orange (Randomize)
| Token | Hex | Usage |
|:---|:---|:---|
| `--accent` | `#FF5500` | Active buttons, selected states, fire button |
| `--accent-hover` | `#E64D00` | Hover on accent elements |
| `--accent-light` | `#FFF0E6` | Selected cell background |
| `--accent-border` | `#FFB380` | Selected cell border, target tags |

### Accent — Blue (Envelope)
| Token | Hex | Usage |
|:---|:---|:---|
| `--env-color` | `#22AAFF` | Envelope meter fill, active dot, mode button |
| `--env-light` | `#E6F5FF` | Envelope-related hover states |

### Semantic Colors
| Token | Hex | Usage |
|:---|:---|:---|
| `--locked-bg` | `#FFF0F0` | Locked parameter cell |
| `--locked-border` | `#FFCCCC` | Locked parameter border |
| `--locked-icon` | `#CC3333` | Lock icon color |
| `--auto-lock-bg` | `#FFF5E6` | Auto-detected lock (Master Vol) |
| `--auto-lock-border` | `#FFD699` | Auto-lock border |
| `--midi-dot` | `#33CC33` | MIDI activity indicator |

---

## Typography

### Font Stack
- **UI**: `Inter`, `-apple-system`, `system-ui`, `sans-serif`
- **Values/Mono**: `JetBrains Mono`, `SF Mono`, `Consolas`, `monospace`

### Sizes
| Usage | Size | Weight |
|:---|:---|:---|
| Brand name | 12px | 600 |
| Parameter name | 10px | 500 |
| Parameter value | 10px (mono) | 400 |
| Block title | 11px | 600 |
| Block summary | 10px | 400 |
| Section title | 10px | 600 |
| Block label | 9px | 600 |
| Sub-label | 9px | 400 |
| Status bar | 10px (mono) | 400 |
| Button text | 10px | 600 |

### Text Transform
- Section titles: `UPPERCASE`, `letter-spacing: 1px`
- Block labels: `UPPERCASE`, `letter-spacing: 0.6px`
- Brand name: `UPPERCASE`, `letter-spacing: 0.8px`
- Fire button: `UPPERCASE`, `letter-spacing: 1px`

---

## Spacing

- Grid gap: 4px
- Cell padding: 7px 8px
- Block body padding: 10px
- Block row gap: 10px
- Section bar height: 28px
- Header height: 40px
- Status bar height: 22px

---

## Component Styles

### Segmented Control
- Background: `--bg-inset` with 1px `--border`
- Buttons: equal width, 5px 2px padding
- Active (Randomize): `--accent` bg, white text
- Active (Envelope): `--env-color` bg, white text
- Border-right between buttons: 1px `--border`

### Toggle Switch
- Track: 28 × 14px, `--bg-inset`, 1px `--border`
- Thumb: 10 × 10px circle, white, 1px `--border-strong`
- Active: track → `--accent`, thumb slides right
- Transition: 80ms ease

### Slider Row
- Label: 9px, `--text-secondary`, min-width 32px
- Track: height 4px, `--bg-inset`, 2px radius
- Thumb: 14px circle, white fill, 2px `--border-strong` border, 50% radius
- Thumb hover: border → `--accent`
- Thumb active: border → `--accent`, `0 0 0 3px var(--accent-light)` shadow
- Value: 10px mono, `--text-secondary`, min-width 32px, right-aligned

### Target Tag
- Background: `--accent-light`
- Border: 1px `--accent-border`
- Text: `--accent`, 9px, weight 500
- × button: 10px, 0.6 opacity → 1.0 on hover
- Border radius: 2px

### FIRE Button
- Full width of block
- Height: 28px
- Background: `--accent` → `--accent-hover` on hover
- Text: white, 10px, weight 600, uppercase
- Active: `scale(0.98)`
- Flash animation: 250ms `box-shadow: 0 0 12px var(--accent)` fade

### Envelope Level Meter
- Height: 40px
- Background: `--bg-inset`, 1px `--border`
- Fill: linear-gradient from `--env-color` (bottom) to translucent blue (top)
- Transition: 30ms linear (real-time response)
- Label: 9px mono, top-right corner

### Activity Dots (Status Bar)
- Size: 5px circle
- MIDI: `--midi-dot` (green) when active, `--border-strong` when idle
- ENV: `--env-color` (blue) when active, `--border-strong` when idle
- Envelope header dot: 6px, pulsing animation (1s ease-in-out)

---

## Animations

| Element | Trigger | Duration | Easing |
|:---|:---|:---|:---|
| Cell hover | mouseenter | 80ms | ease-out |
| Cell selection | click | 80ms | ease-out |
| Slider thumb hover | mouseenter | 80ms | ease |
| Fire flash | click | 250ms | ease-out |
| Env meter fill | audio input | 30ms | linear |
| Env header dot | continuous | 1000ms | ease-in-out |
| Toggle switch | click | 80ms | ease |
| Value bar | randomize | 180ms | ease-out |

---

## Responsive Behavior
- Fixed 920 × 620px (plugin window)
- Grid columns adapt via `auto-fill` to available width
- Block strip scrolls horizontally
- Parameter grid scrolls vertically
