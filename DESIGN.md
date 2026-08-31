---
name: WMKF Document Processing Suite
description: Calm, task-focused grant-workflow tools that keep records, documents, and decisions clear.
colors:
  foundation-ink: "#111827"
  body-graphite: "#374151"
  muted-graphite: "#6b7280"
  border-gray: "#e5e7eb"
  canvas-gray: "#f9fafb"
  surface-white: "#ffffff"
  working-blue: "#2563eb"
  confirmed-green: "#16a34a"
  warning-amber: "#d97706"
  danger-red: "#dc2626"
  analytical-violet: "#9333ea"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: "2.5rem"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: "2.25rem"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: "2rem"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  2xl: "1rem"
  full: "9999px"
spacing:
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
  "8": "2rem"
components:
  button-primary:
    backgroundColor: "{colors.foundation-ink}"
    textColor: "{colors.surface-white}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1.5rem"
  button-primary-hover:
    backgroundColor: "#1f2937"
    textColor: "{colors.surface-white}"
    rounded: "{rounded.lg}"
  button-secondary:
    backgroundColor: "#f3f4f6"
    textColor: "{colors.foundation-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1.5rem"
  button-outline:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.body-graphite}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1.5rem"
  button-danger:
    backgroundColor: "{colors.danger-red}"
    textColor: "{colors.surface-white}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1.5rem"
  card:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.foundation-ink}"
    rounded: "{rounded.xl}"
    padding: "1.5rem"
  input:
    backgroundColor: "{colors.surface-white}"
    textColor: "{colors.foundation-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.5rem 1rem"
  status-chip:
    backgroundColor: "#f0fdf4"
    textColor: "#15803d"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.75rem"
---

# Design System: WMKF Document Processing Suite

## Overview

**Creative North Star: "The Clear Workbench"**

The suite should feel like a well-prepared working surface: calm, precise, and
trustworthy, with the record, the evidence, and the next action easy to locate.
It is an internal operational environment rather than a consumer product, so
clarity and confidence outrank visual novelty, marketing gloss, or theatrical
effects.

The incumbent system is quietly tactile and decisive. Neutral surfaces and
fine borders organize dense grant work; restrained elevation marks interaction
and overlays; dark primary actions make commitments unambiguous. Color appears
when it conveys action, status, or risk, not as decoration.

**Key Characteristics:**

- Neutral-first, information-dense, and task-focused.
- White working surfaces on a cool gray canvas.
- Dark, decisive primary actions with explicit secondary choices.
- Semantic color used sparingly and consistently.
- Rounded, lightly layered components with brief feedback.

## Colors

The palette is led by ink, paper, and gray structure. The configured blue,
green, and violet ramps remain supporting tools, but they do not compete with
the neutral operational hierarchy.

### Primary

- **Foundation Ink** (`#111827`): Main headings, active tabs, and the dominant
  action color for operational decisions.
- **Working Blue** (`#2563eb`): Links, focus, and actions that already use the
  configured primary ramp; it is a signal, not a page-filling brand field.

### Secondary

- **Confirmed Green** (`#16a34a`): Success, availability, completion, and
  affirmative state.

### Tertiary

- **Analytical Violet** (`#9333ea`): A supporting analytical or review accent
  where that distinction already exists; never a default surface color.
- **Warning Amber** (`#d97706`): Attention, uncertainty, stale state, and
  recoverable conflict.
- **Danger Red** (`#dc2626`): Destructive actions, blocking errors, and critical
  states.

### Neutral

- **Surface White** (`#ffffff`): Cards, dialogs, menus, and primary work areas.
- **Canvas Gray** (`#f9fafb`): Page background and quiet supporting regions.
- **Border Gray** (`#e5e7eb`): Default dividers and container boundaries.
- **Body Graphite** (`#374151`): Strong secondary text and control labels.
- **Muted Graphite** (`#6b7280`): Metadata, inactive navigation, and supporting
  copy.

### Named Rules

**The Meaningful Color Rule.** Neutral surfaces carry structure. Blue is for
action, green for confirmed success, amber for attention, red for danger or
failure, and violet only where an analytical/review distinction already exists.

## Typography

**Display Font:** Inter (with system UI and sans-serif fallback)
**Body Font:** Inter (with system UI and sans-serif fallback)
**Label Font:** Inter (with system UI and sans-serif fallback)

**Character:** One pragmatic sans-serif family keeps dense interfaces legible
and consistent. Hierarchy comes from weight, scale, line height, and spacing,
not decorative type changes.

### Hierarchy

- **Display** (700, `2.25rem` / responsive `3rem`, `2.5rem` line height): Suite
  landing title and rare page-level moments.
- **Headline** (600, `1.875rem`, `2.25rem` line height): Major page or section
  heading where the surface has room.
- **Title** (600–700, `1.25rem`–`1.5rem`, `1.75rem`–`2rem` line height): Request
  titles, card titles, and primary panel headings.
- **Body** (400, `1rem`, `1.5` line height): Reading copy and normal control
  content; operational panels commonly step down to `0.875rem` for density.
- **Label** (500–600, `0.75rem`–`0.875rem`, normal case): Navigation, field
  labels, badges, and compact metadata.

### Named Rules

**The Scan-First Type Rule.** Hierarchy comes from size, weight, and spacing—not
decorative font changes.

## Layout

The outer shell uses a cool-gray full-height canvas with white header and footer
bands. Primary page content typically sits inside an `80rem` (`max-w-7xl`)
container with `1rem` horizontal gutters. Landing cards move from one column to
two at `768px` and three at `1024px`; operational surfaces favor stacked panels,
flex rows, and grids that collapse naturally on narrow screens.

Spacing follows Tailwind's 4px-based scale, with `0.5rem`, `0.75rem`, `1rem`,
`1.25rem`, `1.5rem`, and `2rem` doing most of the work. Cards usually use
`1.25rem`–`1.5rem` padding. Related controls use small gaps; major sections use
`1.5rem`–`2rem` separation. Dense admin and Workbench panels may compress the
rhythm, but should keep labels, controls, and state feedback visually grouped.

Navigation is horizontal above the medium breakpoint and becomes menu-driven or
horizontally scrollable when space is constrained. Workbench tabs use a simple
bottom border for active state and preserve the request context above the tab
strip.

## Elevation & Depth

The system uses light structural layering. Borders and tonal contrast establish
most hierarchy; shadows are shallow at rest, strengthen on hover, and become
pronounced only for menus, dialogs, and drawers. This keeps dense pages grounded
while making transient layers unmistakable.

### Shadow Vocabulary

- **Surface Rest** (`0 1px 2px 0 rgb(0 0 0 / 0.05)`): Default cards and page
  bands.
- **Surface Response** (`0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)`): Hovered cards and compact popovers.
- **Overlay** (`0 20px 25px -5px rgb(0 0 0 / 0.10), 0 8px 10px -6px rgb(0 0 0 / 0.10)`): Dialogs, drawers, and menus that must separate from the work surface.

### Named Rules

**The Border-Before-Shadow Rule.** Use borders and tonal contrast to establish
structure; increase shadow only for interaction or true overlay depth.

## Shapes

Controls and inputs usually use an `0.5rem` radius. Cards and menus use
`0.75rem`; larger external-facing or empty-state containers may use `1rem`.
Status chips, avatars, counters, and icon buttons use full rounding when their
compact silhouette carries meaning. One-pixel gray borders are the default
container edge; clipping is reserved for menus, dialogs, and deliberately
contained media.

The form language is soft-edged but not pill-heavy. Full pills belong to badges
and compact state, not ordinary buttons, fields, or large containers.

## Components

### Buttons

- **Shape:** Rounded operational control (`0.5rem`) with semibold label.
- **Primary:** Foundation Ink on white, commonly `0.75rem 1.5rem`; hover shifts
  to gray-800.
- **Secondary:** Gray-100 on Foundation Ink; hover deepens the neutral surface.
- **Outline:** White with a gray-300 border and Body Graphite label; hover uses
  Canvas Gray.
- **Danger:** Danger Red on white, reserved for destructive or critical actions.
- **Hover / Focus:** Brief `200ms` state feedback and an explicit two-pixel focus
  ring with offset. Disabled controls reduce opacity and suppress pointer intent.

### Chips

- **Style:** Small, semibold, full-radius labels with pale semantic backgrounds,
  darker semantic text, and an optional matching border.
- **State:** Green confirms, amber warns, red blocks, blue informs, and gray
  describes neutral or terminal state. Text always carries the meaning.

### Cards / Containers

- **Corner Style:** `0.75rem` by default; `1rem` for larger external or centered
  states.
- **Background:** Surface White on Canvas Gray.
- **Shadow Strategy:** Shallow at rest; a modest lift and stronger border on
  interactive cards.
- **Border:** One-pixel Border Gray, strengthening to gray-300 on interaction.
- **Internal Padding:** Usually `1.25rem`–`1.5rem`.

### Inputs / Fields

- **Style:** White field, gray-300 border, `0.5rem` radius, and `0.5rem 1rem`
  internal padding.
- **Focus:** An explicit ring or border shift. The shared field primitive uses
  Working Blue; newer Workbench forms may use Foundation Ink. Preserve the
  established treatment within a surface rather than mixing both in one form.
- **Error / Disabled:** Pale red or gray state surfaces, clear text, and visible
  borders; never rely on placeholder text or color alone.

### Navigation

- **Global:** Compact icon-and-label links in muted gray on white. Hover adds a
  quiet gray surface and stronger text; mobile navigation becomes a menu.
- **Workbench:** A horizontal, overflow-safe tab strip. The active tab uses
  Foundation Ink text and a two-pixel bottom border; inactive tabs remain
  borderless and muted.

### Dialogs and Drawers

Dialogs use a dimmed backdrop, white surface, `0.75rem`–`1rem` corners, and an
overlay shadow. Headers, content, errors, and actions remain visibly separated.
Drawers follow the same surface language but preserve full-height task context.

## Do's and Don'ts

### Do:

- **Do** use Foundation Ink for the primary operational action and active state.
- **Do** let white surfaces, gray borders, and spacing carry most structural hierarchy.
- **Do** reserve semantic color for action, status, risk, and established analytical meaning.
- **Do** use `0.5rem` controls, `0.75rem` cards, and full rounding for compact status.
- **Do** keep state feedback brief, explicit, and paired with text or iconography.

### Don't:

- **Don't** turn the configured blue, green, and violet ramps into competing brand fields.
- **Don't** elevate every container; use stronger shadows only for interaction and overlays.
- **Don't** introduce consumer-SaaS gloss, theatrical effects, or decorative branding into operational surfaces.
- **Don't** introduce a suite-wide logo treatment without a new explicit brand decision.
- **Don't** communicate consequential state through color alone.
