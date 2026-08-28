# Adapting the Explanation to Its Format

Use this reference when a substantial explanation needs an intentional depth strategy. Choose the lightest structure that gives the intended reader a complete path.

## Decide What Stays Visible

Keep these on the default path:

- the core answer or mental model;
- the context required to understand it;
- definitions needed for the next step;
- decision-relevant choices, tradeoffs, and risks;
- evidence or uncertainty that materially changes the conclusion;
- any content another authoritative skill requires to remain visible.

Good candidates for a deeper layer include:

- extended derivations or implementation traces;
- additional examples and edge cases;
- exhaustive source or provenance detail;
- raw commands, identifiers, and long tables;
- background that helps some readers but is not prerequisite to the main point.

Optional does not mean obscure. Label deeper material by what the reader will gain, not merely “More details.”

## Chat and Conversational Answers

- Answer the question in the opening paragraph or first short section.
- Use headings only when they make a real multi-part answer easier to scan.
- Put the most useful example near the concept it explains.
- Offer deeper mechanics, alternatives, or edge cases after the complete short answer.
- End with a follow-up invitation only when another choice or level of depth would genuinely help.

Avoid turning a simple answer into a mini-report or ending every response with a generic offer.

## Markdown, Documents, and Reports

- For long material, open with a short orientation or executive summary.
- Organize the body around the reader's questions or conceptual progression, not the order in which sources were inspected.
- Use summaries, callouts, tables, or worked examples where they reduce cognitive load.
- Put long derivations, exhaustive evidence, detailed provenance, and secondary cases in clearly named sections or appendices.
- Repeat a conclusion only when the repetition helps a reader re-enter after a long or technical section.

For evidence reviews, incident reports, or audits, evidence may legitimately be central. Explain the question, conclusion, and consequence before presenting raw chronology unless chronology itself is the subject.

## Slide Narratives

- Give each slide one main teaching job and make the title express its point when possible.
- Sequence context, intuition, example, mechanism, and implication across slides rather than compressing them onto one slide.
- Put nuance, citations, and presenter-only transitions in speaker notes when the audience does not need them on screen.
- Use a recap or return to the mental model after a dense technical sequence.
- Prefer diagrams, contrasts, or one worked example over paragraphs of prose.

Do not imitate HTML disclosure controls, shrink text to preserve completeness, or make slides understandable only through undocumented conversation history.

## Interactive HTML and Tutorials

- Start with semantic headings and a complete readable document structure.
- Use native disclosures or simple depth controls when they reduce default load; keep individual sections reachable without a global preset.
- Preserve keyboard access, visible focus, correct names and states, logical focus movement, and reduced-motion behavior.
- Design responsively and visually validate representative desktop, tablet, and mobile sizes.
- Keep core meaning available without requiring decorative interaction. For a requested self-contained or offline artifact, use local assets and verify an offline reload.
- Use specialized UI, accessibility, or browser-validation guidance when available; this skill does not replace those checks.

Label controls by the depth they reveal, such as “Worked example” or “Math and implementation,” rather than vague tiers.

## Procedures and Operational Guides

- State the outcome, prerequisites, and safety boundary before the command sequence.
- Keep commands exact and easy to copy, but explain why non-obvious steps exist.
- Separate the ordinary path from recovery, rollback, or advanced variants.
- Keep destructive effects, external consequences, and approval requirements visible rather than placing them in an appendix.

## When Not to Layer

Do not add summaries, appendices, disclosures, or staged sequencing when the entire answer is already short and clear. Progressive revelation should reduce cognitive load, not manufacture structure.
