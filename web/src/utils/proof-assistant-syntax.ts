import type { HLJSApi, Language } from "highlight.js";
import coq from "highlight.js/lib/languages/coq";

/**
 * highlight.js's Coq grammar (Rocq is Coq's current name), with one fix: its match-arm rule
 * colours everything from a `|` to the next word as a type, which catches goal patterns
 * (`H : P |- _`) and the `||` tactic combinator in nearly every proof. Matching those two
 * operators first keeps them, and the tactic after `||`, out of that rule.
 */
export function rocq(hljs: HLJSApi): Language {
  const base = coq(hljs);
  return { ...base, contains: [{ match: /\|\||\|-/ }, ...(base.contains ?? [])] };
}

/**
 * highlight.js grammar for Lean 4. highlight.js ships no Lean grammar, and the community
 * `highlightjs-lean` package targets Lean 3 (`begin ... end` proofs, `tt`/`ff`), so this small
 * grammar covers Lean 4 and Mathlib: commands, term syntax, common tactics, nested block comments,
 * `@[...]` attributes and declaration names.
 */
export function lean(hljs: HLJSApi): Language {
  const declaration = /\b(?:theorem|lemma|def|abbrev|instance|structure|class|inductive|opaque|axiom)\b/;
  return {
    name: "Lean",
    keywords: {
      // `#check` and friends start with `#`; primes and `?`/`!` end names like `h'` and `exact?`.
      $pattern: String.raw`#?[A-Za-z_][\w']*[!?]?|λ|∀|∃`,
      keyword: [
        "theorem lemma def abbrev example instance class structure inductive axiom opaque",
        "where deriving extends namespace section end open import export variable universe",
        "set_option attribute local scoped private protected noncomputable partial unsafe mutual",
        "macro macro_rules syntax elab notation infix infixl infixr prefix postfix",
        "fun λ ∀ ∃ let have show from by do then else if match with at calc return for in mut",
        "termination_by decreasing_by #check #eval #print #reduce #exit #synth",
      ].join(" "),
      built_in: [
        "intro intros exact apply refine refine' rw rwa rewrite simp simp_all simpa dsimp omega",
        "decide native_decide rfl induction cases rcases obtain constructor use exists linarith",
        "nlinarith norm_num ring field_simp aesop unfold assumption contradiction exfalso trivial",
        "specialize generalize subst congr ext funext conv split_ifs positivity gcongr tauto",
        "first repeat try all_goals any_goals case next exact? apply? sorry admit",
      ].join(" "),
      literal: "true false",
      type: "Type Prop Sort Nat Int Bool String Char List Array Option Fin Real",
    },
    contains: [
      hljs.COMMENT("--", "$"),
      hljs.COMMENT("/-", "-/", { contains: ["self"] }),
      hljs.QUOTE_STRING_MODE,
      hljs.NUMBER_MODE,
      { scope: "meta", begin: /@\[/, end: /\]/ },
      { match: [declaration, /\s+/, /[A-Za-z_][\w'.]*/], scope: { 1: "keyword", 3: "title.function" } },
    ],
  };
}
