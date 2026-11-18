# Design evidence ledger

Standards and earlier sources reviewed online on 2026-11-16; product visual studies added on 2026-11-17. These sources inform decisions; they are not proof that a particular layout is best. Publication dates differ from retrieval dates. Established usability and accessibility principles remain useful; check changing platform APIs and product behavior separately.

## Rendered product evidence, added 2026-11-17

See [visual-studies.md](visual-studies.md) for inspected screens, observations, application limits, screenshot filenames, and failed retrievals. See [visual-direction.md](visual-direction.md) for this skill's synthesis. The latter is a working method, not a quotation of source authors or a measured guarantee of quality.

| Study | Primary source | Date and evidence scope |
| --- | --- | --- |
| B01 Linear | https://linear.app/now/behind-the-latest-design-refresh | Published 2026-03-12; article and actual rendered comparison images inspected. |
| B02 Raycast | https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast and https://www.raycast.com/windows | Article dated 2026-05-14; the analyzed product montage is explicitly v1. Current Windows marketing hero also inspected, not treated as working UI. |
| B03 Craft | https://www.craft.do/blog/craft-update-3-3-7 | Published 2026-01-28; article and document-library image inspected. |
| B04 Notion | https://www.notion.com/product | Undated current product page; official workspace demo frame and meeting-list image inspected, not a logged-in session. |
| B05 Slack | https://slack.com/help/articles/360059928654-How-to-use-Slack--your-quick-start-guide and https://slack.com/features/channels | Undated help/product pages; browser redirected to Japanese regional content. Channel illustration and annotated guide image inspected. |
| B06 Superhuman | https://superhuman.com/mail | Undated current product page; Split Inbox image inspected. Lazy-loaded blank or wrong-index captures excluded. |
| B07 Things | https://culturedcode.com/things/features/ | Current reachable page includes visibly older media paths; classic composition example only, not evidence of a recent redesign. |

No source is an objective “most beautiful app” ranking. Product screenshots support visual observations; they do not establish exact tokens, performance, contrast compliance, or real task behavior. Some exploratory links returned 404, redirected, or failed to expose useful UI; those are documented in the visual studies and excluded from substantive claims.

## Product interaction and information structure

1. **Nielsen Norman Group — 10 Usability Heuristics for User Interface Design**
   https://www.nngroup.com/articles/ten-usability-heuristics/
   Read successfully. Supports visible system status, user control, consistency, recognition, and recovery. Apply through task walkthroughs and observable feedback, rather than reciting the heuristics.

2. **Nielsen Norman Group — Progressive Disclosure**
   https://www.nngroup.com/articles/progressive-disclosure/
   Read successfully. Supports moving rarely used detail behind a second level. This does not justify hiding common actions such as creating an agent or saving changes.

3. **Microsoft Fluent 2 — Design principles**
   https://fluent2.microsoft.design/design-principles
   Read successfully. Supports focused, platform-aware experiences and a consistent identity. Prefer familiar desktop interaction where it reduces learning cost.

4. **Microsoft Fluent 2 — Layout**
   https://fluent2.microsoft.design/layout
   Read successfully. Discusses visual grouping, rhythm, density, whitespace, and a four-pixel spacing scale. Whitespace needs a purpose; density also needs to remain legible.

5. **Microsoft Learn — Responsive design techniques**
   https://learn.microsoft.com/en-us/windows/apps/design/layout/responsive-design
   Read successfully. Supports adapting position, size, visibility, and composition to a changing desktop window. Verify the app's actual minimum size instead of assuming a mobile website breakpoint.

## Visual judgment and implementation critique

6. **Linear — How we redesigned the Linear UI**
   https://linear.app/now/how-we-redesigned-the-linear-ui
   Read successfully. A product team's account of alignment, navigation hierarchy, density, and reducing chrome noise. A case study, not a universal requirement to copy Linear's appearance.

7. **Anthropic — frontend-design skill**
   https://github.com/anthropics/skills/tree/main/skills/frontend-design
   Retrieved the repository's SKILL.md successfully. Relevant ideas: deliberate visual direction, typography, product-specific decisions, restrained effects, and critique of rendered work. Follow the user's brief over the source's stylistic preferences. This skill does not adopt its wording or claim that prompting creates expert taste.

8. **Vercel — web-design-guidelines skill and Web Interface Guidelines**
   https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines
   https://github.com/vercel-labs/web-interface-guidelines
   Retrieved SKILL.md and command.md successfully. Useful implementation checks: semantic controls, forms, focus, content overflow, destructive actions, motion, and theme handling. Web routing prescriptions need adaptation for a local desktop app.

## Verifiable accessibility floors

9. **W3C WAI — Understanding SC 1.4.3 Contrast (Minimum)**
   https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
   Read successfully. Use the standard's ratios and exceptions. Contrast alone does not establish overall readability or visual quality.

10. **W3C WAI — Understanding SC 2.5.8 Target Size (Minimum)**
    https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
    Read successfully. Distinguish the 24 CSS px AA requirement and its exceptions from larger recommended touch targets.

11. **W3C WAI — Understanding SC 2.4.11 Focus Not Obscured (Minimum)**
    https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
    Read successfully. Relevant to sticky editor actions, scrollable panels, dialogs, and keyboard use.

## Retrieval limitation

Apple HIG Layout was requested successfully at https://developer.apple.com/design/human-interface-guidelines/layout but only its JavaScript shell was available to the fetcher. Do not cite it as a fully reviewed source or infer its detailed recommendations. Retrieve the actual document before relying on it.

## How to use the evidence

Explain a local observation first, then the relevant principle, then a remedy with a test. Distinguish a normative accessibility rule, a platform convention, a case-study technique, and a stylistic preference. No source establishes a universal best theme, fixed panel percentage, or guaranteed human-expert design level.
