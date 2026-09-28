# Amie — Style Reference
> Sunlit productivity dashboard — a workspace where everything is white, flat, and purposeful, with one electric-blue switch that turns things on.

**Theme:** light

Source: Refero Styles — https://styles.refero.design/style/29567671-da1e-4f85-ae52-8b611fecc384 (captured 2026-09-28).

Amie feels like a well-lit productivity workspace — bright white surfaces, almost clinical in their restraint, punctuated by a single electric sky-blue (#11a8ff) that fires only when action is required. The page is overwhelmingly neutral — 98% achromatic — making every chromatic moment (the amber highlight, the green calendar icon, the violet tag) feel intentional rather than decorative. Inter at tight negative letter-spacing (-0.025em at display sizes) condenses headlines into confident blocks. Cards use hairline 1px borders via layered near-invisible shadows rather than visible strokes, giving product UI previews the appearance of floating slightly off the page.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Pure Canvas | `#ffffff` | `--color-pure-canvas` | Page background, card surfaces, button fills for secondary actions |
| Fog Surface | `#fafafa` | `--color-fog-surface` | Alternate card background, subtle section differentiator |
| Ash Border | `#cdcdcd` | `--color-ash-border` | All UI borders — inputs, cards, dividers, icon rings — at 1px solid |
| Stone Divider | `#ebebeb` | `--color-stone-divider` | Tag backgrounds, highlight pills, section background bands |
| Graphite Body | `#5c5c5c` | `--color-graphite-body` | Secondary body text, nav labels, subtext |
| Silver Muted | `#a0a0a0` | `--color-silver-muted` | Placeholder text, icon strokes, de-emphasized UI labels |
| Ink Primary | `#000000` | `--color-ink-primary` | Primary headings, body text, icon fills |
| Charcoal Dark | `#2e2e2e` | `--color-charcoal-dark` | Dark bordered UI elements, elevated stroke contexts |
| Sky Action | `#11a8ff` | `--color-sky-action` | CTA buttons, active nav highlight, brand accent — the sole chromatic action color |
| Sky Pale | `linear-gradient(to right top, #cfeeff, #41baff)` | `--color-sky-pale` | Highlight backgrounds behind key phrases, decorative gradient start |
| Amie Pink | `#f6a6a6` | `--color-amie-pink` | Decorative accent for soft highlights |
| Mint Active | `#01ca45` | `--color-mint-active` | Icon fill/color accents |
| Violet Tag | `#a050ff` | `--color-violet-tag` | Feature label / tag borders for category chips |
| Amber Highlight | `#fbefaf` | `--color-amber-highlight` | Text highlight background behind a key phrase — single warm note in a cool palette |

## Tokens — Typography

### Inter — Single typeface for all contexts · `--font-inter`
- **Substitute:** Inter (Google Fonts)
- **Weights:** 400, 500, 550, 600, 700
- **Sizes:** 12px, 13px, 14px, 16px, 20px, 40px, 56px
- **Line height:** 1.00–1.75 (display: 1.00–1.14, body: 1.50–1.75)
- **Letter spacing:** -1.40px at 56px (-0.025em), -0.48px at 40px (-0.012em), normal at 16px and below
- **Role:** Mono-typographic system — headlines to captions. Weight 700 at 56px hero display, 600 at 40px section headings, 400–500 body/UI.

### Type Scale

| Role | Size | Line Height | Letter Spacing |
|------|------|-------------|----------------|
| caption | 12px | 1.5 | — |
| body | 14px | 1.75 | — |
| heading-sm | 20px | 1.4 | — |
| heading | 40px | 1.14 | -0.48px |
| display | 56px | 1 | -1.4px |

## Tokens — Spacing & Shapes

**Base unit:** 4px · **Density:** comfortable · **Max width:** 1200px · **Section gap:** 80px · **Card padding:** 16px · **Element gap:** 8px

### Border Radius

| Element | Value |
|---------|-------|
| tags / chips | 9999px |
| badges | 4px |
| inputs | 8px |
| cards | 12px |
| buttons | 12px |
| modals | 16px |

### Shadows

| Name | Value |
|------|-------|
| subtle | `rgba(0,0,0,0.05) 0px 0px 0px 1px inset` |
| subtle-2 (card) | `rgba(0,0,0,0.06) 0px 0px 0px 1px, rgba(0,0,0,0.06) 0px 1px 1px -0.5px, rgba(0,0,0,0.06) 0px 3px 3px -1.5px` |
| subtle-3 | `rgba(0,0,0,0.1) 0px 0px 0px 1px inset` |
| subtle-4 (popover) | `rgba(0,0,0,0.1) 0px 1px 3px 0px, rgba(0,0,0,0.1) 0px 1px 2px -1px` |

## Components

### Primary CTA Button
Background #11a8ff, white text, 12px radius, 12px/28px padding, Inter 600 14px. The only filled chromatic button in the system.

### Ghost Secondary Button
Background #ffffff, text #5c5c5c, 12px radius, 1px border via shadow ring rgba(0,0,0,0.06). Inter 500 14px. Pairs beside the primary CTA as a binary choice.

### Text / Nav Ghost Button
Transparent, text #000000 or #5c5c5c, 0px radius. Inter 400–500 14px.

### Feature Card (White / Off-White)
Background #ffffff (or #fafafa), 12px radius, 3-layer shadow stack acting as the 1px border. Content sets its own padding.

### Highlight Chip
Background #ebebeb, 16px radius, 8px/16px padding, Inter 600. Isolates a key statistic or phrase.

### Category Tag (Pill)
9999px radius, transparent bg, 1px border in category accent (#01ca45 / #a050ff). Inter 500 13px.

### Inline Text Highlight
Background #fbefaf on a span within the heading. No border, no radius. Once per hero.

### Navigation Bar
White bg, backdrop-filter blur(16px) when scrolled. ~60px tall, 1200px max-width. Logo left, links center (Inter 14px 500 #000), CTA right (#11a8ff). Border-bottom 1px #cdcdcd.

### Product Preview Card
White, radius 12px 12px 0 0 (top-rounded, bottom flush). Inner UI grayscale(1), full color on hover/active.

### Social Proof Logo Strip
Logos grayscale(1), horizontally scrolling via scrollX animation (70s linear). No card container.

## Do's and Don'ts

### Do
- Use #11a8ff exclusively for filled CTA buttons — no other UI element gets a chromatic fill color
- Apply letter-spacing -1.40px at 56px and -0.48px at 40px for display and section headings
- Render card borders via the 3-layer shadow stack rather than explicit border-color properties
- Use 9999px radius for tags/pills/chips; 12px for cards and primary buttons
- Highlight key phrases inline with #fbefaf at the span level — only once per hero
- Maintain grayscale(1) on partner logos and secondary product imagery; full color on hover/active
- Keep category accent colors to border-only usage on tags — never fill a UI surface with them

### Don't
- Never add a second chromatic action color — #11a8ff is the only CTA fill
- Do not use weight below 400 or above 700 — 400–700 is the entire system
- Avoid explicit border declarations for cards — the shadow-as-border ring keeps surfaces integrated
- Never use #a0a0a0 or #5c5c5c for headings — strictly secondary body/label colors
- Do not center-align body paragraphs — left-aligned text is the content pattern
- Avoid gradients in UI components — the sky gradient is decorative-only behind highlighted phrases
- Do not apply backdrop-filter blur outside the navigation bar

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Page Canvas | `#ffffff` | Root page background |
| 1 | Card Surface | `#fafafa` | Feature cards and alternate section fills |
| 2 | Raised Card | `#ffffff` | Elevated cards with the 0.06 shadow ring |
| 3 | Highlight Band | `#ebebeb` | Highlight pills, chips, section accent backgrounds |

## Motion

- **Marquee:** logo strip scrolls horizontally, 70s linear infinite
- **Grayscale reveal:** secondary imagery sits at grayscale(1), transitions to full color on hover/active
- **Nav blur:** backdrop-filter blur(16px) appears only when the sticky nav is scrolled
- **Entrances:** compositor-only rise-and-fade with expo-out easing; one-shot, never replaying
- Reduced-motion users get everything static, nothing hidden

## Quick Start — CSS Custom Properties

```css
:root {
  --color-pure-canvas: #ffffff;
  --color-fog-surface: #fafafa;
  --color-ash-border: #cdcdcd;
  --color-stone-divider: #ebebeb;
  --color-graphite-body: #5c5c5c;
  --color-silver-muted: #a0a0a0;
  --color-ink-primary: #000000;
  --color-charcoal-dark: #2e2e2e;
  --color-sky-action: #11a8ff;
  --color-sky-pale: #cfeeff;
  --color-amie-pink: #f6a6a6;
  --color-mint-active: #01ca45;
  --color-violet-tag: #a050ff;
  --color-amber-highlight: #fbefaf;

  --font-inter: 'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;

  --text-caption: 12px;  --leading-caption: 1.5;
  --text-body: 14px;     --leading-body: 1.75;
  --text-heading-sm: 20px; --leading-heading-sm: 1.4;
  --text-heading: 40px;  --leading-heading: 1.14; --tracking-heading: -0.48px;
  --text-display: 56px;  --leading-display: 1;    --tracking-display: -1.4px;

  --radius-cards: 12px; --radius-buttons: 12px; --radius-inputs: 8px; --radius-modals: 16px; --radius-full: 9999px;

  --shadow-subtle: rgba(0,0,0,0.05) 0px 0px 0px 1px inset;
  --shadow-subtle-2: rgba(0,0,0,0.06) 0px 0px 0px 1px, rgba(0,0,0,0.06) 0px 1px 1px -0.5px, rgba(0,0,0,0.06) 0px 3px 3px -1.5px;
  --shadow-subtle-4: rgba(0,0,0,0.1) 0px 1px 3px 0px, rgba(0,0,0,0.1) 0px 1px 2px -1px;
}
```
