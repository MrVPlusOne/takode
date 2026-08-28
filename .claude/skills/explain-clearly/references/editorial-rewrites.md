# Fresh-Reader Editorial Rewrites

## Contents

- [Replace hidden history with the actual point](#replace-hidden-history-with-the-actual-point)
- [Introduce evidence before its limitation](#introduce-evidence-before-its-limitation)
- [Explain conceptual boundaries, not missing handoffs](#explain-conceptual-boundaries-not-missing-handoffs)
- [Remove agent and workflow framing](#remove-agent-and-workflow-framing)
- [Give run names and dates a teaching job](#give-run-names-and-dates-a-teaching-job)
- [Put commands after purpose](#put-commands-after-purpose)
- [Translate evidence labels into prose](#translate-evidence-labels-into-prose)
- [Avoid mechanical section scaffolds](#avoid-mechanical-section-scaffolds)
- [Make active learning earn its place](#make-active-learning-earn-its-place)
- [Run a whole-surface editorial pass](#whole-surface-editorial-pass)

Use these patterns to turn inherited, audit-shaped, or AI-ish prose into a natural explanation without losing accuracy. The flagged phrases are diagnostic signals, not forbidden words; an audit or operational record may need them when they are properly introduced.

## Replace Hidden History with the Actual Point

**Audit-shaped**

> As requested, the prior version was corrected to distinguish the two algorithms.

**Reader-facing**

> The two algorithms solve different problems: one chooses where to spend samples, while the other changes the training objective.

The revision history explains why an editor changed the text, not what a new reader needs to learn.

## Introduce Evidence Before Its Limitation

**Audit-shaped**

> A dated slide claim or command does not match the current mirror.

**Reader-facing**

> This configuration is one historical design, not a guaranteed part of the running system. An earlier presentation describes it, while the available implementation does not enforce it.

Lead with the supported conceptual distinction; give source status and uncertainty second. Name what the source says, what was inspected, and why the difference affects interpretation. Prefer “the available implementation” to opaque inspection shorthand such as “current mirror” unless the mirror itself matters and has been introduced. Do not make “dated,” “current,” or “mismatch” carry unexplained meaning.

## Explain Conceptual Boundaries, Not Missing Handoffs

**Audit-shaped**

> The source does not specify every checkpoint handoff, and the implementation does not hard-code a state machine.

**Reader-facing**

> This four-stage loop is a conceptual pattern, not a fixed sequence built into the training system. Each training program chooses which saved model version advances to the next stage.

Teach what the diagram means before cataloging which orchestration details it does not prove. Keep a precise implementation boundary nearby only when it changes the lesson.

## Remove Agent and Workflow Framing

**Audit-shaped**

> The user should inspect the optional panel, and the agent can answer follow-up questions.

**Reader-facing**

> Open the optional panel for the derivation. If you want to compare the assumptions afterward, use the questions at the end of the section.

Address the reader directly. A brief invitation to continue a live conversation can be natural; repeated references to an assistant turn the artifact into a handoff log.

## Give Run Names and Dates a Teaching Job

**Audit-shaped**

> Run 5.1 improved after the August checkpoint, but this was not reproduced.

**Reader-facing**

> In one internal experiment, the lower-precision setup became more stable after a configuration change. Because the result has not been independently reproduced, it is useful as directional evidence rather than a general performance claim.

Keep the exact run name or date only when the reader needs it to locate, compare, or audit the evidence. Put that identifier in a note or source table when it does not teach the concept.

## Put Commands After Purpose

**Audit-shaped**

> Run `widget inspect --mode full`.

**Reader-facing**

> First verify that the generated artifact contains every expected section. The following command performs that completeness check:
>
> `widget inspect --mode full`

A command is not an explanation. Give the reader the goal and the meaning of the result unless the surrounding procedure already does so.

## Translate Evidence Labels into Prose

**Audit-shaped**

> Verified: the sampler returns alternatives. Not verified: the production rollout uses this path.

**Reader-facing**

> The inspected sampler can return alternative tokens. The available evidence does not establish that every production rollout enables that path.

Formal evidence labels are useful in matrices and audits. In a teaching narrative, state the supported conclusion and its boundary naturally.

## Avoid Mechanical Section Scaffolds

**Generated-sounding**

Every chapter repeats the same “Problem,” “Idea,” and “Takeaway” headings even when a chapter is a definition, comparison, or worked example.

**More natural**

Let the material determine the shape. A definition may move from intuition to boundary cases; a comparison may use a table and synthesis; a worked example may follow one concrete object from start to finish.

Consistency should help navigation, not make each section sound filled from a template.

## Make Active Learning Earn Its Place

**Distracting**

> Quick check: Did you understand the paragraph above?

**Useful**

> Before expanding the derivation, predict what happens when both models assign the token the same probability. The ratio becomes one, so the correction disappears.

Ask about the concept, reveal the reasoning promptly, and use the answer to advance the explanation. Skip the question when it adds ceremony rather than learning.

## Whole-Surface Editorial Pass

Do not stop after fixing quoted examples. Review:

1. title and opening orientation;
2. every default-visible section;
3. optional panels, appendices, and footnotes;
4. examples, captions, tables, control labels, and alt text;
5. speaker notes or presenter guidance;
6. closing prompts and calls to action.

For each internal-sounding phrase, choose one action:

- remove it if it exists only because of hidden history;
- rewrite it as the underlying fact or concept;
- add the context that makes it meaningful;
- move it to provenance or an appendix if it is necessary but not pedagogically central.

Then check that uncertainty, evidence boundaries, citations, safety constraints, and source fidelity remain intact.

Words such as “agent,” “checkpoint,” or “run” are not banned when they are the actual subject and are defined for the reader. The target is unexplained internal framing, not keyword compliance.
