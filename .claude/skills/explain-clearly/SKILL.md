---
name: explain-clearly
description: "Use when creating or substantially revising a non-trivial user-facing explanation or informative or educational artifact—including multi-paragraph chat or Markdown, documents, reports, slide narratives, tutorials, and explanatory HTML—so it is natural, audience-aware, intuition-first, progressively layered, and self-contained for a fresh reader. Skip the full workflow for trivial one-line replies, pure translation, raw code or data delivery without explanatory prose, and internal agent work logs. When a narrower authoritative skill governs the task, follow it first and use this skill only for the reader-facing presentation layer; never weaken that skill's workflow, safety, approval, citation, accessibility, format, or completeness requirements."
---

# Explain Clearly

Help the reader understand the point, not merely receive correct information. Shape the explanation around the audience, purpose, medium, and stakes instead of forcing one template.

## Keep Narrower Skills Authoritative

Apply any more specific skill or required workflow first. This skill may improve the surrounding explanation, but it must not weaken or hide:

- approval choices, tradeoffs, safety boundaries, or exact requested actions;
- required citations, provenance, uncertainty, or evidence limits;
- format-specific accessibility, rendering, validation, or completeness rules;
- technical contracts, operational steps, or source fidelity.

For example, `leader-decision-communication` still owns the order and visible content of a leader decision. Use this skill only to make supporting context easier to follow. If a direct concise answer is clearer than a layered explanation, answer directly.

## Build the Explanation

### 1. Set the reader and purpose

Infer or establish:

- what the reader needs to understand, decide, or do;
- what they probably already know;
- which terms or prerequisites need nearby explanation;
- which detail is essential now and which can wait.

Do not assume that a fresh reader is a beginner. Match the depth to the actual audience. State an audience assumption only when it materially affects the answer.

### 2. Lead with the core point

Give the answer, conclusion, or mental model before the machinery. Explain why it matters in language the reader can use. Prefer intuition before formalism unless the audience or request clearly calls for a formal-first treatment.

### 3. Create a readable path

- Supply context before qualifications that depend on it.
- Define unfamiliar terms near first use.
- Use short, coherent chunks rather than a wall of detail.
- Choose concrete examples that teach the idea, not examples that merely prove research was done.
- Signpost real shifts in topic or depth and synthesize after dense passages.
- Vary sentence and section shape naturally. Do not repeat a rigid “problem / idea / takeaway” scaffold until it sounds generated.

### 4. Layer detail for the medium

Make the default path complete but light. Put secondary derivations, exhaustive evidence, edge cases, or reference material in a deeper layer when the medium supports it.

Progressive revelation is a principle, not an HTML widget. Chat can use a short answer followed by optional deeper sections; a document can use summaries and appendices; slides can sequence ideas and move nuance into speaker notes; HTML can use accessible disclosures or depth controls.

Read [format-adaptation.md](references/format-adaptation.md) when the output spans several sections, uses a formal artifact format, or needs a deliberate depth strategy.

Never hide information the reader must see to act safely, make a decision, interpret the central claim, or satisfy another skill's contract.

### 5. Preserve accuracy in reader-facing language

Distinguish facts, implementation evidence, interpretation, uncertainty, and provenance, but do not make those labels the conceptual spine unless the genre is explicitly an audit or evidence review.

Place a limitation next to the claim when it changes the claim's meaning. Otherwise, move detailed evidence and provenance to notes, references, or an appendix. When a passage mixes a concept with a source comparison, state the supported conceptual lesson first and give the source boundary second; do not open with source age or inspection status unless the comparison itself is the reader's question. Contextualize dates, run names, commands, source differences, and implementation snapshots before relying on them. Relocating a caveat is acceptable; erasing it is not.

### 6. Add active learning only when it helps

Use a prediction, short question, worked example, misconception check, or invitation to continue when it improves understanding. Reveal or explain the answer promptly. Do not turn every explanation into a quiz, interrupt a time-sensitive task, or add interaction only to appear engaging.

### 7. Run a fresh-reader editorial pass

Review every reader-facing surface: title, opening, default path, optional sections, examples, captions, callouts, speaker notes, controls, and closing text.

Remove or rewrite language that assumes hidden conversation, revision, agent, quest, checkpoint, or audit history. Introduce necessary dates, experiments, commands, implementation states, and source limitations with enough context to explain why they matter. Translate source-inspection shorthand too: unless a repository mirror is itself relevant and defined, state what “the available implementation” establishes instead of referring to a “current mirror.” Keep genre-required operational or audit detail, but order and phrase it for its real audience.

Read [editorial-rewrites.md](references/editorial-rewrites.md) when revising inherited material, evidence-heavy prose, or text that sounds like an AI work log.

## Final Check

Before delivering, ask:

- Does the reader encounter the main point before supporting machinery?
- Is the explanation self-contained for its intended audience rather than dependent on hidden history?
- Are definitions, examples, and qualifications close to the ideas they clarify?
- Is the default detail manageable, with deeper material still easy to find?
- Does the chosen medium reveal depth naturally instead of imitating another format?
- Are uncertainty, provenance, safety, decisions, and required constraints still accurate and visible?
- Unless the task is an evidence review, does the conceptual lesson lead and the source audit support it rather than replace it?
- Does the prose sound written for a person rather than generated from an audit trail or repeated template?

Revise any answer that fails a material check. Stop when the explanation is clear and complete; do not keep polishing for cosmetic uniformity.
