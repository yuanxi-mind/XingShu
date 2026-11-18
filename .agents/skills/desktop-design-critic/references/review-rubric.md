# Review rubric

Use this as a reasoning aid, not a requirement to redesign every page or a numerical beauty contest. Record each area as pass, issue, or unverified with evidence. Pick checks relevant to the product and current scope.

## Task and navigation

- Can a first-time user identify the main object, current project or workspace, and next action?
- Can a returning user perform frequent work without reopening advanced settings or repeatedly scrolling past unrelated forms?
- Are global, project, conversation, and per-agent settings distinguishable?
- Are view, edit, create, archive/delete, cancel, and back actions named consistently?
- For proposed features, is there a coherent entry point and full return path, including failure and cancellation?

## Composition and space

- Does the main task receive most of the useful space? Do panels earn their area through content or utility?
- Are list and editor separately understandable? Is the selected object visible? Are important actions visible at the start of the task?
- Do alignment, proximity, headings, and spacing express relationships without wrapping every element in a card?
- Is line length appropriate to the content? Do long messages, tables, code, paths, and model IDs remain accessible?
- Are resizable/collapsible panels useful, with sensible minimums and persisted preferences where appropriate?
- Are there accidental nested scroll regions? Does the focused control stay visible behind sticky bars?

## Visual craft

- Name the style in concrete terms: hierarchy, density, surfaces, type, palette, and role of imagery. Match the brief, rather than a trend.
- Use distinguishable type roles and a consistent spacing rhythm. Avoid oversized labels and tiny secondary text chosen only to fit more controls.
- Apply accent color to priority and selection; use explicit text/icon status as well as color for errors and progress.
- Check alignment, baseline, border consistency, icon stroke/weight, and optical balance in rendered screenshots.
- Check both actual themes when supported. Evaluate contrast against the actual composited background, including images and transparency.
- Preserve user backgrounds without sacrificing text readability; do not blindly darken every image or crop it without a fit choice.

## Visual acceptance, separate from functional acceptance

Use [the visual direction method](visual-direction.md) for substantial visual work and [the product studies](visual-studies.md) for concrete, qualified examples. Do not turn this list into a universal requirement to restyle a local fix.

- **Reference quality:** Were actual app screens visually inspected? Are working UI, promotional mockups, diagrams, and landing-page decoration distinguished? Are dates and retrieval limits accurate?
- **Composition:** At thumbnail size, can the main content and next action be found? At normal size, does supporting navigation remain legible without dominating? Is useful space allocated intentionally?
- **Coherence:** Do typography, surfaces, icon weight, spacing, selection, and depth belong to one system across the touched screens? Is there a deliberate identity rather than a collage of fashionable products?
- **Chinese typography:** In a Chinese brief, are interface labels and states translated? Is the actual Chinese-capable font available and rendered? Are mixed text, punctuation, line breaks, long labels, and desktop scaling inspected?
- **Content realism:** Does the layout work with many conversations, long agent names, long Chinese messages, code, files, and different image shapes? Are empty and error states designed with the same care?
- **Craft:** At original rendering size, are baselines, optical alignment, borders, nested radii, state changes, and motion consistent? Does personality survive without drowning out work?
- **Comparison:** Do matching before/after screenshots address the actual aesthetic complaint? State any remaining visual weakness; do not cite passing tests or a famous font/library as proof of attractive design.

Record functional and visual acceptance independently as pass, issue, or unverified with evidence. A style preference can be a valid user requirement without being a universal usability defect. Do not invent numerical beauty scores or claim a review equals a user study.

## Interaction and accessibility

- Controls need accessible names, visible focus, keyboard operation, and predictable tab order. Prefer native semantics.
- Text contrast: WCAG AA generally requires 4.5:1 for ordinary text and 3:1 for qualifying large text, subject to the standard's exceptions.
- Pointer target minimum: WCAG 2.2 AA uses 24 × 24 CSS px or its specified spacing/exception alternatives. A practical larger desktop hit area is a design choice, not a universal 44 px AA requirement.
- Sticky elements must not fully hide focused controls. Modals need focus containment, return focus, Escape/cancel, and clear scope.
- Show immediate local acknowledgement for user input. Distinguish saving, saved, generating, delivery error, and uncertain remote completion.
- Respect reduced motion. Never use continuous decorative animation to imply agent execution.

## Data and AI-specific checks

- Confirm or offer undo for destructive actions. Explain exactly what is removed and what remains.
- Block deletion of an object in use or handle its dependencies explicitly. Check restart persistence and stale selections.
- Do not reset credentials, per-agent model choices, history, or project identity during UI saves.
- Preserve unsaved edits on failed requests; do not silently discard edits when changing items or pages.
- Use execution receipts, citations, and accessible artifacts where relevant. State unsupported capabilities honestly.
- Keep private data out of screenshots and external research requests. Use fixtures for destructive and paid workflows.

## Evidence and severity

- Blocking: core task impossible, data loss, private-data exposure, or misleading claim of completed work.
- Major: common task repeatedly costly, hidden, clipped, or unreliable.
- Moderate: recoverable confusion, inconsistent hierarchy, or avoidable visual friction.
- Minor: polish without meaningful task impact.

Finding format: `location | observation | user cost | remedy | acceptance check | evidence`.

Use actual measurements when helpful: viewport, item count, scroll distance, button position, overflow width, or number of steps. Do not invent conversion rates, eye-tracking results, or “expert scores.” Before/after comparisons need matching conditions.
