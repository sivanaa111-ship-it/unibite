# Admin Page Overrides

> **PROJECT:** UniBite
> **Generated:** 2026-11-22 17:55:56
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1200px (standard)
- **Layout:** Full-width sections, centered content
- **Sections:** Hero (Video/Mission) > Solutions by Industry > Solutions by Role > Client Logos > Contact Sales

### Spacing Overrides

- No overrides — use Master spacing

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- **Strategy:** Corporate: Navy/Grey. High integrity. Conservative accents.

### Component Overrides

- Avoid: Wide tables breaking layout
- Avoid: Single row actions only
- Avoid: Auto-play high-resolution loops without pause or captions

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Purposeful admin feedback and restrained transitions
- Responsive: Use horizontal scroll or card layout
- Data Entry: Allow multi-select and bulk edit
- Sustainability: Prefer click-to-play; provide pause and captions; stop off-screen and honor reduced motion
- CTA Placement: Contact Sales (Primary) + Login (Secondary)

---

## Project decisions (admin)

- Keep UniBite brand (red primary, Plus Jakarta Sans) — **not** Fira / glassmorphism, which hurt data-table legibility.
- Layout: fixed slate sidebar `#1E293B` (white text), light content area `#F8FAFC`, white cards.
- Dense spacing (8–32px scale), tables with sticky header, zebra-free rows + hover tint, 14px body.
- Destructive actions (deactivate) always confirm in a modal naming the entity.
