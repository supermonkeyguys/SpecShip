---
name: screenshot-to-code
description: Use when the user provides a UI screenshot and wants to restore/replicate it as code (HTML/CSS, React/Tailwind, etc.). Drives an iterative analyze→DSL→generate→render→diff→refine loop until visual fidelity is achieved.
---

# Screenshot-to-Code: Iterative Visual Restoration

Converts UI screenshots into production frontend code via a structured pipeline:
**Analyze → DSL → Generate → Render → Diff → Refine → Repeat**.

## Core Philosophy

A single pass from screenshot to code is never pixel-perfect. The key to high fidelity is the **render→compare→fix loop**, not a smarter initial prompt. This skill treats code generation as a search problem guided by visual loss.

## When to Use

- User provides a UI screenshot and asks to "recreate this"
- User wants to clone a design from an image/reference
- User asks to convert a Figma/design mockup screenshot to code
- User wants to replicate a website section from a screenshot

Do NOT use for:
- Extracting text from screenshots (OCR task)
- General image description
- Non-UI images (photos, illustrations, charts)

## Workflow

### Phase 1: Structured Analysis (Single Pass)

Read the screenshot and output a **hierarchical DSL** — do NOT generate code yet.

The DSL captures:

```yaml
page:
  dimensions: {width, height}  # inferred or explicit
  fontSystem:                  # detected font stack hints
  colorPalette:                # all hex values found
  spacingScale:                # inferred spacing multiples (4px/8px base?)
  layout:
    type: flex-column
    children:
      - element: NavBar
        bbox: [x, y, w, h]     # approximate
        style:
          background: "#fff"
          borderBottom: "1px solid #e5e7eb"
        children:
          - element: Logo
            type: image
            dimensions: [32, 32]
          - element: NavLinks
            type: flex-row
            gap: 24px
            children:
              - element: Link
                text: "Home"
                style: {fontSize: 14px, color: "#333", fontWeight: 400}
              - element: Link
                text: "About"
                style: {fontSize: 14px, color: "#0066ff", fontWeight: 600}
      - element: Hero
        ...
```

Rules for DSL output:
1. **Be specific, not vague** — "16px" not "small", "#333" not "dark"
2. **Capture spatial relationships** — gap, padding, margin, alignment
3. **Note uncertainties explicitly** — "16px or 20px" when ambiguous
4. **Identify reusable patterns** — repeated card structures, consistent button styles
5. **Mark inferred vs. observed** — observed colors/fonts are certain, spacing is inferred

### Phase 2: Code Generation

Generate code from the DSL. Ask the user for target stack if not specified (default: HTML + Tailwind CSS).

Key rules:
- Generate the **skeleton first** (all elements, no styles), then layer on **layout** (flex/grid/gap), then **visual** (colors/shadows/fonts)
- Use the user's existing component library if available (check project for shadcn/antd/etc.)
- Write to a single file initially; split into components only on the second iteration

### Phase 3: Render & Capture

Use Playwright MCP to render the generated code:

1. If it's a static HTML file, use `mcp__playwright__browser_navigate` with `file://` URL
2. Wait for full render (fonts, images)
3. Use `mcp__playwright__browser_take_screenshot` to capture the rendered result
4. Read back both the original screenshot and the rendered screenshot

### Phase 4: Visual Diff Analysis

Present both screenshots (original + rendered) to Claude Vision and ask:

1. **Layout differences**: misaligned elements, wrong spacing, incorrect widths
2. **Color differences**: wrong hex values, missing gradients, incorrect opacity
3. **Typography differences**: wrong size, weight, line-height, font family
4. **Missing/extra elements**: omissions or additions
5. **Priority ranking**: which discrepancies have the biggest visual impact

Output a ranked fix list:
```
[P0] Hero padding should be 80px not 64px — most visible
[P1] Nav link active color is #0066ff not #0055ee
[P2] Card border-radius is 12px not 8px — subtle
[P3] Shadow on cards missing entirely
```

### Phase 5: Targeted Refinement

Fix ONLY the top-ranked discrepancies. Do NOT regenerate from scratch — edit the existing code file.

After fixing, return to Phase 3 (re-render, re-diff).

### Phase 6: Termination

Stop the loop when:
- All P0/P1 issues resolved AND remaining P2 issues are < 3 minor color/spacing tweaks
- OR two consecutive iterations show no meaningful improvement
- OR user says stop

## Iteration Budget

- Default: max 5 render→diff→fix cycles
- If fidelity is still poor after 3 cycles, consider: is the target stack wrong? Are there missing assets (custom fonts, images)?
- Report fidelity score at each iteration (rough %: "~85% match, gap is mostly spacing")

## What This Skill CANNOT Do

- **Extract exact font families** from rendered text in a screenshot — always an inference
- **Recover hover/active/focus states** — static image, single state only
- **Infer responsive breakpoints** — only the visible width is captured
- **Extract animations/transitions** — no motion information in a screenshot
- **Recover backend logic** — forms submit to nowhere, buttons have no handlers

For these, ask the user or apply sensible defaults.

## Quick Start Prompt Template

When invoked, lead with:

```
I'll restore this UI screenshot in 6 steps:

1. Analyze → structured DSL (layout tree + styles)
2. Generate → [target stack] code
3. Render → Playwright screenshot of generated code
4. Diff → visual comparison, ranked fix list
5. Refine → targeted fixes
6. Loop → repeat 3-5 until converged

Target stack: [ask if not specified]
Max iterations: 5

Starting analysis now...
```

## Dependencies

- **Claude Vision**: built-in, for screenshot analysis and visual diff
- **Playwright MCP**: for rendering and screenshot capture
- **Write/Edit tools**: for code output
- No external packages required

If Playwright MCP is not available, fall back to: generate code → ask user to screenshot it → user provides the screenshot for diff. Degraded but still functional.
