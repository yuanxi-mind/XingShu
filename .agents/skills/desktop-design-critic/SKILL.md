---
name: desktop-design-critic
description: Research relevant well-crafted applications, establish a coherent visual direction, and review or improve desktop app aesthetics and UX through rendered comparisons and task walkthroughs. Use for unattractive interfaces, whole-app design reviews, navigation or settings redesigns, and proposed screens or interactions. Adapt to the user's style and platform; exclude backend-only changes.
license: MIT
---

# Desktop design critic

Act as a product designer who is accountable for how the finished application works and looks. Review the experience, not only the CSS. The deliverable is a useful design decision supported by an observed problem, a coherent proposal, and verified results when implementation is authorized. “Beautiful,” “premium,” and “master-level” are goals, not findings or guarantees.

## Establish the brief

Read the project's context and the user's latest constraints. Identify the audience, primary job, platform, dominant content, chosen visual direction, data that must survive, and scope of authorized changes. Resolve these from existing material before asking questions. A research workspace, a messenger, and an image editor need different hierarchies and density.

For XingShu or a Chinese-language brief, use Chinese interface copy and Chinese-capable UI fonts. For other projects, follow the project's chosen language and locale. Buttons, navigation, settings, validation, empty states, and status messages need Chinese wording; preserve proper names and exact technical values where necessary. Choose and verify the actual Chinese font, not only a Latin family with an accidental fallback. See the Chinese typography checks in the visual direction reference.

Write a short internal design contract: the main task must be obvious; supporting controls must be available without dominating; state changes must be truthful and visible; the user's theme and personalization remain usable. Specify what this iteration will fix and how success will be observed. Do not make the user approve routine reversible design decisions.

Load [the review rubric](references/review-rubric.md) for an audit or redesign. Load [the source ledger](references/design-sources.md) when grounding recommendations or checking standards. Use authoritative sources for concrete platform or accessibility requirements. Re-fetch sources for claims that may have changed; a recent retrieval date does not make an old principle a new discovery. Do not equate GitHub stars or fashionable effects with design quality.

## Calibrate taste against real interfaces

For a visual overhaul, an open-ended aesthetic complaint, or an explicit request to learn from other apps, read [the visual studies](references/visual-studies.md) and [the visual direction method](references/visual-direction.md). The studies are examples with limits, not a ranking or a permanent list of the latest products. For a small local correction, use only the relevant reference rather than restarting a whole-app study.

Select a small, relevant reference set: a product with a similar main task, one with excellent dense-tool organization, and a different expressive direction when personality matters. Follow a user-specified reference. Prefer official app screenshots, product demos, or design-team case studies. Inspect rendered images with the available image/browser tools. Reading a blog, recognizing a brand, or capturing a file is not the same as looking at the interface.

Distinguish working UI, curated product mockup, annotated diagram, and marketing page. Record the exact screen, source URL, publication date if known, retrieval date, and which parts were actually inspected. Re-fetch current examples when asked; exclude failed loads and unrelated redirects from visual evidence. Never infer exact font sizes, contrast compliance, interaction behavior, or measured speed from a compressed promotional image.

When the brief calls for cute characters, pets, illustration, or more color, read [expressive interface studies](references/expressive-interfaces.md). Preserve that requested personality rather than defaulting to grayscale utility styling. Inspect real assets at their intended display size, distinguish community characters from official branding, and check image licenses separately from repository code licenses.

For each useful reference, write a short chain: **visible decision → visual effect → transferable rule → boundary**. Analyze composition, density, typography, color roles, surface hierarchy, imagery, and state treatment. Pick one primary visual language and translate other references into it. Do not combine one product's sidebar, another's cards, and a third's buttons without reconciling their proportions, tokens, and interaction model.

## Set art direction before styling

Write a compact direction with a primary content focus, composition, type hierarchy including Chinese fallback, semantic palette, surface depth, density, and one purposeful signature. Translate vague requests such as “cool,” “premium,” or “less ugly” into concrete choices in those areas. Preserve the user's chosen aesthetic; a playful, photographic, or cyberpunk product can still be coherent and readable.

For broad implementation work, build one representative high-fidelity screen with realistic content and its busy or failure state before spreading the style across the app. Compare the rendered result against the reference at equivalent window and content scale; then apply the resolved language to adjacent authorized screens. This is an implementation checkpoint, not an automatic user-approval gate. If the request is research or skill improvement, deliver the research or skill rather than modifying the app.

Treat usability and visual quality as separate acceptance gates. Correct behavior, accessibility, a component library, or passing tests does not establish attractive design. Resolve the large composition before tuning components, then refine typography and optical alignment. Use the three-scale comparison in the visual direction reference. Keep design judgments explicit and evidenced rather than inventing objective beauty scores.

## Experience the product

Use the available browser, Electron, or desktop automation tools. Inspect which tools actually exist. When operating the app is impossible, say which conclusions rely only on screenshots or code, and keep untested behavior explicitly unverified.

Use an isolated fixture for create/edit/delete, errors, and interrupted operations. Keep real credentials masked. Block paid model, image, and external write calls during visual testing unless the task specifically authorizes them. Read-only checks on real data can validate names, scale, and navigation. Do not delete real agents, messages, projects, or files to demonstrate a design.

Walk through the user's primary task end to end as a first-time user and as a returning user. Inspect actual pages and transitions, not just the default screenshot. Include relevant empty, populated, busy, success, validation-error, failure, cancellation, and recovery states. Use realistic Chinese text, long names, many agents or conversations, and long output. Test the actual window size, an ordinary laptop size, and a narrower supported window; inspect desktop scaling if available.

Record steps, clicks, scroll requirements, screenshots, clipped content, focus behavior, and state changes. Ask at each step: What would someone expect next? Is that expectation met? Can they tell what happened and recover? A menu that technically exists but is buried under a long form is a discoverability problem.

## Critique from product to pixels

Review in this order; styling cannot repair a broken workflow:

1. **Product structure:** objects and relationships, navigation, ownership, project boundaries, and missing decisions or transitions. Distinguish a missing capability from an existing capability with a hidden entry point. New feature recommendations do not authorize implementation.
2. **Task flow:** first useful action, repeated work, immediate feedback, predictable save semantics, destructive actions, undo or confirmation, shortcuts, and recovery. Explain consequences in the user's vocabulary.
3. **Information and space:** primary versus secondary work, reading order, grouping, content density, panel proportions, disclosure of advanced controls, and scroll ownership. Space should communicate relationships or aid reading, rather than come from accidental giant rows or arbitrary maximum widths.
4. **Visual composition:** alignment, type hierarchy, color roles, contrast, surface depth, rhythm, icon consistency, imagery, and restraint. Choose a coherent direction grounded in this product. Do not substitute a universal dark/purple/glass template for judgment. If the user chooses that style, execute it deliberately.
5. **Interaction craft:** hover, focus, selection, disabled, loading, streaming, responsive resizing, reduced motion, and stable layout. Motion should explain a change or status. Never invent percentages or simulate work that has not happened.

For each serious finding, provide: observed evidence and location; user impact; smallest complete remedy; acceptance check. Label observations, hypotheses, and design preferences separately. Avoid invented usability-study results, unsupported superiority claims, and numerical design scores presented as scientific measurements.

If direction is genuinely open, compare at most two materially different concepts before choosing. State the tradeoff in workflow or content, not a list of decorative adjectives. Do not redesign unrelated areas while fixing a local complaint.

## Design the complete interaction

Define the object, entry point, essential fields, advanced fields, save behavior, cancellation, validation, loading, errors, deletion consequences, and return destination. Reuse a familiar interaction when it fits; preserve the app's distinctive visual language.

For repeated configuration objects, prefer a scan-friendly collection and one focused editor over stacking all forms. Keep collection actions near the collection heading. Keep the current item's identity and save action visible. Separate connection credentials from agent identity while showing their relationship. Existing user values and secrets must survive layout changes.

For AI workspaces, distinguish configured ability, granted permission, proposed action, approved action, actual execution, and verified result. Show the user's message immediately and mark delivery truthfully. Make recipient selection, task responsibility, evidence, file versions, and scope of memory understandable where relevant. Do not make unsupported tools appear functional through labels or animation.

Use a small token vocabulary for color, type, spacing, radius, and state. Derive tokens from the existing app when suitable. Do not globally change typography or force a theme when the request is local. Use semantic controls, readable labels, keyboard access, and theme-aware contrast. Do not add libraries or generated images solely to make the design look more elaborate.

## Build, inspect, revise

Implement only authorized changes. Cover callers, persistence, IPC, navigation, empty states, and cancellation when the change crosses those boundaries. Preserve data, identity, model routing, and secrets.

Run the finished app. Capture before and after at the same viewport, theme, scale, and representative state. Inspect the images visually. Check that the remedy improves the complaint without breaking adjacent flows. Reproduce create, save, reopen, delete/cancel, and restart in fixtures where relevant. Validate narrow windows, overflow, keyboard focus, reduced motion, and long content in touched areas. Do not accept passing type checks as proof of visual quality.

Use an adversarial second pass: identify the most awkward remaining step, the most visually distracting element, and a realistic failure state. Fix material defects within scope and repeat the affected checks. Avoid endless polishing or declaring perfection. Stop when the acceptance checks pass and remaining limitations are recorded.

For material visual work, report the remaining aesthetic weakness as well as functional defects. Reject a result that passes workflows but still repeats the user's complaint: competing focal points, incoherent type or surfaces, obstructed content, or decorative effects without a deliberate composition. Rework the responsible layer instead of adding another coat of CSS.

Verify the distributed application contains the tested UI. Check the executable, shortcut, and build identity when packaging is part of the task; an edited source file is not a deployed fix.

## Delivery

Lead with the observable result. Keep the user-facing report short: changes they can see, how to reach them, tests actually performed, and material remaining limitations. Keep detailed findings, evidence, source dates, and screenshots in a local report when the audit warrants it. Do not expose API keys or private conversation contents in shared screenshots or reports.

For review-only requests, deliver prioritized recommendations with evidence. For an unbuilt feature, deliver an interaction proposal and acceptance checks, explicitly marked as proposed. For implementation requests, finish the change and inspect the running result before claiming completion.
