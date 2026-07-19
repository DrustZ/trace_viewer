/**
 * Shared text pools for the scenario generators. One pool item per task
 * instance: the same instance keeps the same problem across checkpoints so
 * the Evolution view can join on instanceId.
 */

import type { Rng } from './rng'

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// ---------------------------------------------------------------------------
// System / developer prompts. One pool per component; every trace opens with
// a rng-picked system persona, and the code-agent components (swebench,
// terminal-bench) add a developer message with tool inventory + policy.
// ---------------------------------------------------------------------------

export const MATH_SYSTEM_PROMPTS: readonly string[] = [
  'You are a competition mathematics assistant. Reason through each problem carefully in the analysis channel, verifying every algebraic and arithmetic step before committing. End with exactly one final answer wrapped in \\boxed{}.',
  'You are an expert solver of olympiad-style math problems. Work the derivation out step by step, double-checking arithmetic against small cases where possible. The final message must state a single boxed answer and nothing else.',
  'You solve short-answer competition math problems. Keep the derivation self-contained and re-verify any modular or combinatorial step. Answer with \\boxed{} notation.',
]

export const SCIENCE_SYSTEM_PROMPTS: readonly string[] = [
  'You are a science tutor answering exam-style questions across physics, chemistry, and biology. Reason from definitions and standard formulas rather than surface keywords. Give a single, direct final answer.',
  'You answer multiple-choice and short-answer science questions. Eliminate distractors explicitly in your reasoning and cite the governing principle. State the final answer on its own line; a reference judge will grade it.',
  'You are a careful STEM question-answering assistant. Check units and definitions before committing to an option. Keep the final answer concise so it can be matched against the reference.',
]

export const SWE_SYSTEM_PROMPTS: readonly string[] = [
  'You are an autonomous software-engineering agent operating in a sandboxed checkout of the target repository. Diagnose the reported issue, make the smallest fix that resolves it, and verify with the project test suite. Prefer reading code over guessing.',
  'You are a coding agent assigned a real bug report in an open-source repository. Explore the codebase to localize the fault, apply a minimal patch, and re-run the failing tests to confirm. Keep the diff as small as possible.',
  'You fix bugs in large Python codebases. Reproduce the failure first when practical, then edit only what the fix requires and validate by running the tests. Do not refactor unrelated code.',
]

export const SWE_DEVELOPER_PROMPTS: readonly string[] = [
  'Available tools: bash (shell commands in the repo sandbox) and str_replace_editor (exact string-replacement edits). Policy: never push directly or rewrite git history; do not modify test files; run the test suite before declaring the task complete.',
  'Tool inventory: bash for exploration and running tests; str_replace_editor for all file edits. Policy: work only inside /testbed, never push directly, and keep every patch to the minimal hunk that fixes the issue.',
]

export const TERM_SYSTEM_PROMPTS: readonly string[] = [
  'You are a terminal operations agent with root access to a single Linux host. Inspect before you mutate: survey state with read-only commands, then apply the smallest change that completes the task. Verify the result before finishing.',
  'You administer Linux systems through a shell. Plan destructive operations carefully, prefer dry-runs where the tooling offers them, and confirm success with an explicit check command at the end.',
  'You are an SRE agent completing operational tasks on production-like hosts. Keep commands idempotent where possible and never delete data the task asks you to preserve. Finish by verifying the task condition.',
]

export const TERM_DEVELOPER_PROMPTS: readonly string[] = [
  'Available tools: bash (interactive shell on the target host, runs as root). Safety rules: no rm -rf outside the task scope, never edit /etc/passwd or /etc/shadow directly, dry-run destructive finds before -delete or -exec rm, and stop if a command would take the host offline.',
  'Tool inventory: bash only; every command executes on the live host as root. Policy: quote paths defensively, avoid wildcards in destructive commands until verified with a list-only run, and re-check disk and service state after any mutation.',
]

export const LEET_SYSTEM_PROMPTS: readonly string[] = [
  'You are a competitive-programming assistant solving LeetCode-style problems. Choose the asymptotically appropriate algorithm, note edge cases before coding, and submit a complete Python solution. The grader runs a fixed hidden test suite.',
  'You solve algorithm problems and submit Python code to an automated judge. Reason about complexity and boundary conditions first, then write the full solution class in one piece. Report which cases pass after the run.',
  'You are a coding assistant for algorithmic interview problems. Identify the invariant that makes the approach correct, then implement it in Python 3 and run it against the test cases.',
]

export const SEARCH_SYSTEM_PROMPTS: readonly string[] = [
  'You are a research agent that answers factual questions using a web search tool. Decompose the question, verify each fact against at least two independent sources, and synthesize a concise sourced answer.',
  'You answer multi-hop factual questions by searching the web. Do not rely on memory alone: confirm names, dates, and figures in retrieved snippets before committing. Give one final answer covering every part of the question.',
  'You are a browsing assistant for hard research questions. Issue targeted queries, cross-check disagreeing sources, and answer only after each sub-fact is independently confirmed.',
]

// ---------------------------------------------------------------------------
// stem/deepscaler-math
// ---------------------------------------------------------------------------

export interface MathItem {
  problem: string
  answer: string
  wrong: string
  /** Correct derivation paragraphs; the last one commits to the answer. */
  derivation: string[]
  /** Replaces the last derivation paragraph on failed rollouts; contains the slip. */
  slip: string
}

export const MATH_FILLERS: readonly string[] = [
  'Let me double-check the arithmetic before committing to that.',
  'Sanity check: plugging in the two smallest cases reproduces the pattern, so the setup is consistent.',
  'I should verify the modular step once more — off-by-one errors are easy here. Recomputing carefully gives the same residue, so the argument stands.',
  'Alternative route: brute force over a small range agrees with the closed form, which is reassuring.',
  'Re-reading the problem statement to make sure no constraint was dropped: positive integers only, and the bound is inclusive. Both are respected above.',
  'One more pass over the algebra: expanding and collecting terms gives exactly the same expression, so no sign was lost.',
  'Checking the boundary case explicitly: it satisfies the condition, so the count includes it.',
  'Quick estimate: the magnitude of the result is in the right ballpark for a problem of this size, which supports the computation.',
  'To be safe, I will redo the final subtraction digit by digit. The difference comes out the same.',
  'The factorization is unique, so there is no double counting in the enumeration.',
]

export const MATH_ITEMS: readonly MathItem[] = [
  {
    problem:
      'Find the sum of all positive integers $n \\le 100$ such that $n^2 + 3n + 2$ is divisible by $6$.',
    answer: '3367',
    wrong: '3421',
    derivation: [
      'The expression factors as $(n+1)(n+2)$, a product of two consecutive integers, so it is always even. Divisibility by 6 therefore reduces to divisibility by 3.',
      'Modulo 3, $(n+1)(n+2) \\equiv 0$ fails exactly when $n \\equiv 0 \\pmod 3$, since then $n+1 \\equiv 1$ and $n+2 \\equiv 2$. So the valid $n$ are precisely those not divisible by 3.',
      'The sum $1 + 2 + \\dots + 100 = 5050$; the multiples of 3 up to 99 sum to $3(1+2+\\dots+33) = 3 \\cdot 561 = 1683$. The answer is $5050 - 1683 = 3367$.',
    ],
    slip: 'The sum $1 + 2 + \\dots + 100 = 5050$; the multiples of 3 up to 99 sum to $3(1+2+\\dots+33) = 3 \\cdot 543 = 1629$, so the answer is $5050 - 1629 = 3421$.',
  },
  {
    problem: 'Let $f(x) = x^2 - 6x + 11$. Find the minimum value of $f$ on the interval $[0, 5]$.',
    answer: '2',
    wrong: '11',
    derivation: [
      'Complete the square: $f(x) = (x-3)^2 + 2$, so $f$ is a parabola opening upward with vertex at $x = 3$.',
      'Since $3 \\in [0, 5]$, the minimum over the interval is attained at the vertex, not at an endpoint. Evaluating, $f(3) = 2$.',
    ],
    slip: 'The vertex lies at $x = 3$, but on a closed interval the extremum is attained at an endpoint, so the minimum is $f(0) = 11$.',
  },
  {
    problem:
      'How many ordered pairs $(a, b)$ of positive integers satisfy $ab = 720$ and $\\gcd(a, b) = 6$?',
    answer: '4',
    wrong: '6',
    derivation: [
      'Write $a = 6m$, $b = 6n$ with $\\gcd(m, n) = 1$. Then $36mn = 720$, so $mn = 20$.',
      '$20 = 2^2 \\cdot 5$ has two distinct prime factors, and each full prime power must go entirely to $m$ or to $n$ to keep them coprime. That gives $2^2 = 4$ ordered pairs: $(1,20), (4,5), (5,4), (20,1)$.',
    ],
    slip: 'The ordered factorizations of 20 are $(1,20), (2,10), (4,5)$ and their reverses, all with coprime parts, giving 6 pairs.',
  },
  {
    problem: 'Compute the remainder when $7^{2026}$ is divided by $100$.',
    answer: '49',
    wrong: '43',
    derivation: [
      'Powers of 7 modulo 100 cycle with period 4: $7, 49, 43, 1, 7, \\dots$',
      'Since $2026 = 4 \\cdot 506 + 2$, we have $2026 \\equiv 2 \\pmod 4$, so $7^{2026} \\equiv 7^2 = 49 \\pmod{100}$.',
    ],
    slip: 'Since $2026 \\equiv 3 \\pmod 4$, the remainder is the third element of the cycle, namely $43$.',
  },
  {
    problem: 'A right triangle has hypotenuse $26$ and inradius $5$. Find its area.',
    answer: '155',
    wrong: '130',
    derivation: [
      'For a right triangle with legs $a, b$ and hypotenuse $c$, the inradius is $r = (a + b - c)/2$. With $r = 5$ and $c = 26$ this gives $a + b = 36$.',
      'The area equals $rs$ where $s$ is the semiperimeter: $s = (a + b + c)/2 = (36 + 26)/2 = 31$, so the area is $5 \\cdot 31 = 155$.',
    ],
    slip: 'The area equals $r \\cdot c = 5 \\cdot 26 = 130$ by the standard incircle formula.',
  },
  {
    problem: 'Find the number of real solutions of $x^4 - 5x^2 + 6 = 0$.',
    answer: '4',
    wrong: '2',
    derivation: [
      'Substitute $u = x^2$: then $u^2 - 5u + 6 = 0$ factors as $(u-2)(u-3) = 0$, so $u = 2$ or $u = 3$.',
      'Both values are positive, and each positive $u$ contributes two real roots $x = \\pm\\sqrt{u}$. Hence there are $4$ real solutions.',
    ],
    slip: 'So $x^2 = 2$ or $x^2 = 3$, giving the two real solutions $x = \\sqrt{2}$ and $x = \\sqrt{3}$.',
  },
  {
    problem: 'Evaluate $\\sum_{k=1}^{10} k \\cdot k!$.',
    answer: '39916799',
    wrong: '39916800',
    derivation: [
      'Use the identity $k \\cdot k! = (k+1)! - k!$, which telescopes the sum.',
      'The sum collapses to $11! - 1! = 39916800 - 1 = 39916799$.',
    ],
    slip: 'The sum telescopes to $11!$, which is $39916800$.',
  },
  {
    problem:
      'In how many ways can $8$ people be seated around a round table if two particular people refuse to sit next to each other? (Rotations are considered identical.)',
    answer: '3600',
    wrong: '4320',
    derivation: [
      'Total circular arrangements of 8 people: $(8-1)! = 5040$.',
      'Arrangements where the pair sits together: glue them into one block, giving $(7-1)! = 720$ circular arrangements, times $2$ for the order within the block, i.e. $1440$.',
      'By complement, $5040 - 1440 = 3600$.',
    ],
    slip: 'Arrangements with the pair together: treating the pair as one block gives $6! = 720$, so the answer is $5040 - 720 = 4320$.',
  },
  {
    problem:
      'Find the smallest positive integer $n$ such that $n!$ ends in exactly $10$ trailing zeros.',
    answer: '45',
    wrong: '40',
    derivation: [
      'The number of trailing zeros of $n!$ is $Z(n) = \\lfloor n/5 \\rfloor + \\lfloor n/25 \\rfloor + \\dots$',
      '$Z(44) = 8 + 1 = 9$ while $Z(45) = 9 + 1 = 10$, and $Z$ is nondecreasing, so the smallest such $n$ is $45$.',
    ],
    slip: '$Z(40) = \\lfloor 40/5 \\rfloor + \\lfloor 40/25 \\rfloor = 8 + 2 = 10$, so the smallest such $n$ is $40$.',
  },
  {
    problem: 'A sequence satisfies $a_1 = 3$ and $a_{n+1} = 2a_n + 1$. Find $a_{10}$.',
    answer: '2047',
    wrong: '1023',
    derivation: [
      'Adding 1 to both sides gives $a_{n+1} + 1 = 2(a_n + 1)$, so $b_n = a_n + 1$ is geometric with ratio 2 and $b_1 = 4$.',
      'Thus $b_n = 2^{n+1}$ and $a_n = 2^{n+1} - 1$. In particular $a_{10} = 2^{11} - 1 = 2047$.',
    ],
    slip: 'Thus $a_n = 2^n - 1$, so $a_{10} = 2^{10} - 1 = 1023$.',
  },
]

// ---------------------------------------------------------------------------
// stem/nemotron-science
// ---------------------------------------------------------------------------

export interface ScienceItem {
  question: string
  answer: string
  wrong: string
  reasoning: string[]
  judgePass: string
  judgeFail: string
}

export const SCIENCE_FILLERS: readonly string[] = [
  'Cross-checking against the definition to make sure the terms are not being conflated.',
  'The distractor options are plausible but each fails on one specific criterion, which I will spell out.',
  'Recalling the standard textbook treatment of this topic to anchor the answer.',
  'Units check: the quantities combine to the expected dimension, so the relation is applied correctly.',
  'Eliminating options one by one is safer than pattern-matching on keywords here.',
  'This is a classic point of confusion; the key distinction is worth stating explicitly before answering.',
]

export const SCIENCE_ITEMS: readonly ScienceItem[] = [
  {
    question:
      'Which planet in the Solar System has the highest average density?\nA) Jupiter  B) Earth  C) Mercury  D) Neptune',
    answer: 'B) Earth',
    wrong: 'C) Mercury',
    reasoning: [
      'Bulk densities: Earth ~5.51 g/cm^3, Mercury ~5.43 g/cm^3, Jupiter ~1.33 g/cm^3, Neptune ~1.64 g/cm^3.',
      'Mercury is a common trap because it is the most iron-rich, but Earth wins due to gravitational compression of its interior. The answer is Earth.',
    ],
    judgePass:
      'The response selects Earth and supports it with the correct bulk density comparison (5.51 vs 5.43 g/cm^3). The reasoning matches the reference. Verdict: correct.',
    judgeFail:
      'The response selects Mercury, but the reference answer is Earth: Earth has the highest bulk density at 5.51 g/cm^3 versus Mercury at 5.43 g/cm^3. The stated comparison is wrong. Verdict: incorrect.',
  },
  {
    question:
      'What are the primary energy-carrying products of the light-dependent reactions of photosynthesis?',
    answer: 'ATP and NADPH',
    wrong: 'Glucose',
    reasoning: [
      'The light-dependent reactions occur in the thylakoid membrane and convert light energy into chemical carriers.',
      'Glucose is produced later by the Calvin cycle, which consumes the carriers. The light reactions themselves yield ATP and NADPH (with O2 as a byproduct).',
    ],
    judgePass:
      'The response names ATP and NADPH and correctly distinguishes them from Calvin-cycle products. This matches the reference answer. Verdict: correct.',
    judgeFail:
      'The response answers glucose, which is a Calvin-cycle product, not a product of the light-dependent reactions. The reference answer is ATP and NADPH. Verdict: incorrect.',
  },
  {
    question:
      'Which quantum number determines the shape of an atomic orbital?\nA) principal (n)  B) azimuthal (l)  C) magnetic (m_l)  D) spin (m_s)',
    answer: 'B) azimuthal (l)',
    wrong: 'A) principal (n)',
    reasoning: [
      'n sets the energy/size, l sets the angular momentum and hence the shape (s, p, d, f), m_l sets the orientation, m_s the spin.',
      'So the shape is governed by the azimuthal quantum number l.',
    ],
    judgePass:
      'The response picks the azimuthal quantum number and correctly maps n, l, m_l, m_s to size, shape, orientation, and spin. Verdict: correct.',
    judgeFail:
      'The response picks the principal quantum number, which determines size and energy, not shape. The reference answer is the azimuthal quantum number l. Verdict: incorrect.',
  },
  {
    question:
      'Two objects of different mass are dropped from rest near the surface of the Earth with air resistance neglected. How do their accelerations compare?',
    answer: 'Both accelerate at the same rate, g ≈ 9.8 m/s^2, independent of mass',
    wrong: 'The heavier object accelerates faster',
    reasoning: [
      'Newton: F = ma with F = mg gives a = g, the mass cancels.',
      'So in vacuum both fall with identical acceleration ~9.8 m/s^2; mass only matters once drag is reintroduced.',
    ],
    judgePass:
      'The response states that acceleration is g for both bodies and shows the mass cancellation. It matches the reference. Verdict: correct.',
    judgeFail:
      'The response claims the heavier body accelerates faster, contradicting the mass cancellation in F = mg = ma. The reference answer is equal acceleration g. Verdict: incorrect.',
  },
  {
    question: 'What type of chemical bond holds Na and Cl together in solid NaCl?',
    answer: 'Ionic bond',
    wrong: 'Covalent bond',
    reasoning: [
      'The electronegativity difference between Na (0.93) and Cl (3.16) exceeds ~1.7, so electron transfer dominates over sharing.',
      'Na+ and Cl- form an ionic lattice; there is no discrete molecule with a shared pair.',
    ],
    judgePass:
      'The response identifies the bond as ionic and justifies it with the electronegativity gap and lattice structure. Verdict: correct.',
    judgeFail:
      'The response calls the bond covalent, but the large electronegativity difference (~2.2) makes NaCl the textbook ionic solid. Verdict: incorrect.',
  },
  {
    question: 'State the second law of thermodynamics for an isolated system.',
    answer: 'The entropy of an isolated system never decreases over time',
    wrong: 'Energy is conserved in an isolated system',
    reasoning: [
      'The first law is energy conservation; the second law is directional: spontaneous processes increase total entropy.',
      'For an isolated system, dS >= 0 with equality only for reversible processes.',
    ],
    judgePass:
      'The response states dS >= 0 for isolated systems and distinguishes it from the first law. Matches the reference. Verdict: correct.',
    judgeFail:
      'The response states energy conservation, which is the first law of thermodynamics. The reference answer concerns entropy never decreasing. Verdict: incorrect.',
  },
  {
    question: 'Which blood cells are primarily responsible for oxygen transport in humans?',
    answer: 'Red blood cells (erythrocytes)',
    wrong: 'White blood cells (leukocytes)',
    reasoning: [
      'Erythrocytes are packed with hemoglobin, whose iron centers bind O2 in the lungs and release it in tissues.',
      'Leukocytes serve immune defense and platelets serve clotting; neither carries meaningful oxygen.',
    ],
    judgePass:
      'The response names erythrocytes and explains the hemoglobin mechanism, matching the reference. Verdict: correct.',
    judgeFail:
      'The response names leukocytes, which are immune cells; oxygen transport is done by hemoglobin in erythrocytes. Verdict: incorrect.',
  },
  {
    question:
      'A 24 g sample of a radioactive isotope has a half-life of 5 years. How much remains after 15 years?',
    answer: '3 g',
    wrong: '6 g',
    reasoning: [
      '15 years is exactly 3 half-lives, so the remaining mass is 24 / 2^3.',
      '24 -> 12 -> 6 -> 3, leaving 3 g.',
    ],
    judgePass:
      'The response computes 3 half-lives and divides 24 g by 8 to get 3 g, matching the reference. Verdict: correct.',
    judgeFail:
      'The response gives 6 g, which corresponds to only 2 half-lives; 15 years is 3 half-lives of 5 years, leaving 3 g. Verdict: incorrect.',
  },
  {
    question: 'What is the pH of a 0.001 M solution of HCl (a strong acid, fully dissociated)?',
    answer: '3',
    wrong: '11',
    reasoning: [
      'Full dissociation gives [H+] = 10^-3 M.',
      'pH = -log10[H+] = 3. A pH of 11 would correspond to a base, not an acid.',
    ],
    judgePass:
      'The response computes pH = -log(10^-3) = 3 with correct reasoning about full dissociation. Verdict: correct.',
    judgeFail:
      'The response answers pH 11, which is basic; a 0.001 M strong acid has [H+] = 10^-3 and pH 3. The sign of the logarithm was mishandled. Verdict: incorrect.',
  },
  {
    question:
      'An ambulance siren approaches a stationary observer at constant speed. How does the observed frequency compare to the emitted frequency, and why?',
    answer: 'Higher, due to the Doppler effect compressing wavefronts ahead of the source',
    wrong: 'Lower, because the waves stretch out as the source moves',
    reasoning: [
      'A source moving toward the observer shortens the effective wavelength: successive wavefronts are emitted from closer positions.',
      'Shorter wavelength at fixed wave speed means higher observed frequency; the drop to lower pitch happens only after the source passes.',
    ],
    judgePass:
      'The response says the observed frequency is higher and explains wavefront compression ahead of a moving source. Matches the reference. Verdict: correct.',
    judgeFail:
      'The response claims a lower frequency on approach, inverting the Doppler effect; compression ahead of the source raises the observed frequency. Verdict: incorrect.',
  },
]

/** Model tag stamped on every meta.extra.judge record. */
export const JUDGE_MODEL = 'judge-llm-v2'

/** Rubric/check sentences mixed into the judge chain-of-thought (1-3 per verdict). */
export const JUDGE_CHECKS: readonly string[] = [
  'I compared the stated justification against the reference reasoning point by point rather than keyword-matching.',
  'Formatting differences alone (casing, option letters, extra qualifiers) were not held against the response.',
  'No partial credit applies on this item: the rubric is a binary match against the reference.',
  'The response contains no contradictory statements elsewhere that would override its committed answer.',
  'Where the response cites figures, I verified they match the reference values before scoring.',
]

/**
 * Deterministic 4-8 sentence judge chain-of-thought referencing the candidate
 * answer against the golden reference. `outcome` 'truncated' covers responses
 * cut off before committing to an answer.
 */
export function judgeReasoning(
  item: ScienceItem,
  rng: Rng,
  outcome: 'pass' | 'fail' | 'truncated',
  answerText: string,
): string {
  const opener = `The reference (golden) answer for this question is "${item.answer}".`
  const commit =
    outcome === 'truncated'
      ? 'The candidate response is cut off mid-sentence and never commits to a complete final answer.'
      : `The candidate response commits to "${answerText}".`
  const checks = rng.shuffle(JUDGE_CHECKS).slice(0, rng.int(1, 3))
  const closing =
    outcome === 'truncated'
      ? 'With no complete answer to compare against the reference, the response cannot be credited. Verdict: incorrect.'
      : outcome === 'pass'
        ? item.judgePass
        : item.judgeFail
  return [opener, commit, ...checks, closing].join(' ')
}

// ---------------------------------------------------------------------------
// swe/swebench-verified-mini
// ---------------------------------------------------------------------------

export interface SweExplore {
  cmd: string
  out: string
}

export interface SweItem {
  repo: string
  title: string
  body: string
  explores: SweExplore[]
  editPath: string
  oldStr: string
  newStr: string
  testCmd: string
  testFile: string
  testName: string
  failErr: string
  testsTotal: number
  analyses: string[]
  summary: string
  failSummary: string
}

export function pytestFail(
  file: string,
  test: string,
  err: string,
  passed: number,
  total: number,
): string {
  const dots = `${'.'.repeat(Math.max(0, passed))}F${'.'.repeat(Math.max(0, total - passed - 1))}`
  return [
    '============================= test session starts ==============================',
    'platform linux -- Python 3.11.8, pytest-8.0.2, pluggy-1.4.0',
    'rootdir: /testbed',
    `collected ${total} items`,
    '',
    `${file} ${dots}${' '.repeat(Math.max(1, 55 - file.length - total))}[100%]`,
    '',
    '=================================== FAILURES ===================================',
    `${'_'.repeat(Math.max(1, Math.floor((79 - test.length - 2) / 2)))} ${test} ${'_'.repeat(Math.max(1, Math.floor((79 - test.length - 2) / 2)))}`,
    '',
    err,
    '',
    '=========================== short test summary info ============================',
    `FAILED ${file}::${test}`,
    `========================= ${total - passed} failed, ${passed} passed in 3.42s ==========================`,
  ].join('\n')
}

export function pytestPass(file: string, total: number): string {
  return [
    '============================= test session starts ==============================',
    'platform linux -- Python 3.11.8, pytest-8.0.2, pluggy-1.4.0',
    'rootdir: /testbed',
    `collected ${total} items`,
    '',
    `${file} ${'.'.repeat(total)}${' '.repeat(Math.max(1, 55 - file.length - total))}[100%]`,
    '',
    `============================== ${total} passed in 2.87s ===============================`,
  ].join('\n')
}

export const SWE_ITEMS: readonly SweItem[] = [
  {
    repo: 'django/django',
    title: 'QuerySet.only() after select_related() crashes on reverse OneToOne relations',
    body: `Running against main:

    qs = Order.objects.select_related('invoice').only('invoice__number')
    list(qs)

Traceback (most recent call last):
  File "repro.py", line 12, in <module>
    list(qs)
  File "django/db/models/query.py", line 398, in __iter__
    self._fetch_all()
  File "django/db/models/sql/compiler.py", line 1274, in get_related_selections
    raise FieldError(
django.core.exceptions.FieldError: Invalid field name(s) given in select_related: 'invoice'. Choices are: (none)

The same query works on 4.2. Bisects to the deferred-fields refactor.`,
    explores: [
      {
        cmd: "grep -rn 'Invalid field name' django/db/models/sql/compiler.py",
        out: "django/db/models/sql/compiler.py:1268:                    raise FieldError(\ndjango/db/models/sql/compiler.py:1269:                        'Invalid field name(s) given in select_related: %s. '",
      },
      {
        cmd: "sed -n '1250,1280p' django/db/models/sql/compiler.py",
        out: `    def get_related_selections(self, select, select_mask, opts=None, ...):
        ...
        if not select_mask:
            related_fields = []
        else:
            related_fields = [
                f for f in opts.related_objects
                if f.field.unique and f.related_model in select_mask
            ]
        if requested and related_fields == []:
            raise FieldError(
                'Invalid field name(s) given in select_related: %s. '
                'Choices are: %s' % (", ".join(requested), choices or '(none)'))`,
      },
      {
        cmd: 'ls tests/defer_regress',
        out: '__init__.py\nmodels.py\ntests.py',
      },
      {
        cmd: "grep -rn 'select_mask' django/db/models/query.py | head -5",
        out: 'django/db/models/query.py:1533:        select_mask = self.query.get_select_mask()\ndjango/db/models/query.py:1601:        # only() builds the select_mask from concrete fields\ndjango/db/models/query.py:1604:        select_mask = {f.attname: {} for f in fields}',
      },
    ],
    editPath: 'django/db/models/sql/compiler.py',
    oldStr: `            related_fields = [
                f for f in opts.related_objects
                if f.field.unique and f.related_model in select_mask
            ]`,
    newStr: `            related_fields = [
                f for f in opts.related_objects
                if f.field.unique
                and (f.related_model in select_mask or f.name in select_mask)
            ]`,
    testCmd: 'python -m pytest tests/defer_regress/tests.py -x -q',
    testFile: 'tests/defer_regress/tests.py',
    testName: 'test_only_with_reverse_one_to_one',
    failErr: `    def test_only_with_reverse_one_to_one(self):
        qs = Order.objects.select_related('invoice').only('invoice__number')
>       self.assertEqual(qs[0].invoice.number, 'INV-1')
E       django.core.exceptions.FieldError: Invalid field name(s) given in select_related: 'invoice'. Choices are: (none)

tests/defer_regress/tests.py:214: FieldError`,
    testsTotal: 6,
    analyses: [
      'The traceback points at get_related_selections in the SQL compiler. The select mask built by only() apparently no longer contains the reverse OneToOne key, so related_fields comes back empty and the guard raises. Let me find the exact raise site first.',
      'The mask lookup uses f.related_model as the key, but only() stores relation names for reverse relations. That mismatch would make the filter drop the invoice relation. I want to see the surrounding code before touching it.',
      'Confirmed: the comprehension only checks `f.related_model in select_mask`. For reverse OneToOne relations only() keys the mask by relation name. The fix is to also accept f.name.',
    ],
    summary:
      'Fixed the select-mask lookup in get_related_selections to also match reverse OneToOne relations by name. The regression test test_only_with_reverse_one_to_one now passes along with the rest of defer_regress.',
    failSummary:
      'Adjusted the related_fields filter in compiler.py, but the regression test still raises FieldError — the mask key for reverse relations is built elsewhere, so this patch does not resolve the issue.',
  },
  {
    repo: 'sympy/sympy',
    title: 'simplify() turns cos(x)**2 + sin(x)**2 + 1 into 2 only for real symbols',
    body: `>>> from sympy import symbols, sin, cos, simplify
>>> x = symbols('x')
>>> simplify(cos(x)**2 + sin(x)**2 + 1)
cos(x)**2 + sin(x)**2 + 1

Expected 2. With x = symbols('x', real=True) it works. The Pythagorean
identity holds for all complex arguments, so the assumption check in
fu._TR5 looks overly strict.

Traceback (when forcing the failing path with trigsimp deep=True):
  File "sympy/simplify/fu.py", line 433, in _TR5
    if not rv.args[0].is_real:
AttributeError: 'NoneType' object has no attribute 'is_real'`,
    explores: [
      {
        cmd: "grep -rn 'is_real' sympy/simplify/fu.py | head -8",
        out: 'sympy/simplify/fu.py:433:        if rv.args[0].is_real is False:\nsympy/simplify/fu.py:519:        # only rewrite when the base is known real\nsympy/simplify/fu.py:520:        if not rv.args[0].is_real:\nsympy/simplify/fu.py:781:    if a.is_real and b.is_real:',
      },
      {
        cmd: "sed -n '510,530p' sympy/simplify/fu.py",
        out: `def _TR5(rv, max=4, pow=False):
    """Replace sin**2 with 1 - cos(x)**2."""
    def f(rv):
        if not (rv.is_Pow and rv.base.func is sin):
            return rv
        # only rewrite when the base is known real
        if not rv.base.args[0].is_real:
            return rv
        return (1 - cos(rv.base.args[0])**2)**(rv.exp//2)`,
      },
      {
        cmd: 'ls sympy/simplify/tests | head',
        out: 'test_combsimp.py\ntest_cse.py\ntest_fu.py\ntest_function.py\ntest_gammasimp.py\ntest_hyperexpand.py\ntest_powsimp.py\ntest_radsimp.py\ntest_simplify.py\ntest_sqrtdenest.py',
      },
    ],
    editPath: 'sympy/simplify/fu.py',
    oldStr: `        # only rewrite when the base is known real
        if not rv.base.args[0].is_real:
            return rv`,
    newStr: `        # the Pythagorean identity holds for all complex arguments;
        # only skip when the exponent is not a positive even integer
        if rv.exp.is_even is False or rv.exp.is_positive is False:
            return rv`,
    testCmd: 'python -m pytest sympy/simplify/tests/test_fu.py -q -k TR5',
    testFile: 'sympy/simplify/tests/test_fu.py',
    testName: 'test_TR5_complex_argument',
    failErr: `    def test_TR5_complex_argument(self):
        x = Symbol('x')
>       assert simplify(cos(x)**2 + sin(x)**2 + 1) == 2
E       assert cos(x)**2 + sin(x)**2 + 1 == 2

sympy/simplify/tests/test_fu.py:97: AssertionError`,
    testsTotal: 5,
    analyses: [
      'simplify() differs based on real assumptions, so a rewrite rule is gated on is_real. The Pythagorean identity is assumption-free; the gate is wrong. Locating the check in fu.py.',
      'Line 520 skips the sin**2 rewrite for non-real bases. For a plain Symbol, is_real is None, so `not None` is truthy and the rewrite is skipped. The condition confuses None (unknown) with False.',
      'The correct gate should be about the exponent being a positive even integer, not about realness. Preparing a minimal edit.',
    ],
    summary:
      'Removed the incorrect is_real gate in _TR5 — the identity holds for complex arguments — and gated on the exponent instead. test_TR5_complex_argument passes and no other fu tests regress.',
    failSummary:
      'Loosened the assumption check in _TR5, but simplify still returns the unsimplified sum: the same is_real gate is duplicated in _TR6, so the pipeline bails out before reaching the patched rule.',
  },
  {
    repo: 'astropy/astropy',
    title: 'Card.value silently truncates long CONTINUE strings on rewrite',
    body: `Reading a header with a long string value and writing it back drops the
tail of the string:

>>> from astropy.io import fits
>>> c = fits.Card('SVALUE', 'x' * 180)
>>> fits.Card.fromstring(str(c)).value == 'x' * 180
False

Traceback in strict mode:
  File "astropy/io/fits/card.py", line 167, in _format_value
    value = value[:68]
astropy.io.fits.verify.VerifyError: card value truncated to 68 characters

The CONTINUE convention should preserve the full value.`,
    explores: [
      {
        cmd: "grep -rn 'CONTINUE' astropy/io/fits/card.py | head -6",
        out: "astropy/io/fits/card.py:61:CONTINUE_CARD = 'CONTINUE'\nastropy/io/fits/card.py:158:        # long strings are split across CONTINUE cards\nastropy/io/fits/card.py:612:            if card.keyword == CONTINUE_CARD:\nastropy/io/fits/card.py:während:0",
      },
      {
        cmd: "sed -n '155,175p' astropy/io/fits/card.py",
        out: `    def _format_value(self, value):
        # long strings are split across CONTINUE cards
        if isinstance(value, str) and len(value) > 68:
            if not self._use_continue:
                value = value[:68]
        return _format_str(value)`,
      },
      {
        cmd: "grep -rn '_use_continue' astropy/io/fits/card.py | head -4",
        out: 'astropy/io/fits/card.py:104:        self._use_continue = False\nastropy/io/fits/card.py:158:        if not self._use_continue:\nastropy/io/fits/card.py:433:            self._use_continue = keyword == CONTINUE_CARD',
      },
    ],
    editPath: 'astropy/io/fits/card.py',
    oldStr: `        if isinstance(value, str) and len(value) > 68:
            if not self._use_continue:
                value = value[:68]`,
    newStr: `        if isinstance(value, str) and len(value) > 68:
            self._use_continue = True`,
    testCmd: 'python -m pytest astropy/io/fits/tests/test_card.py -q -k continue',
    testFile: 'astropy/io/fits/tests/test_card.py',
    testName: 'test_long_string_roundtrip',
    failErr: `    def test_long_string_roundtrip(self):
        c = fits.Card('SVALUE', 'x' * 180)
>       assert fits.Card.fromstring(str(c)).value == 'x' * 180
E       AssertionError: assert 'xxxx...x' == 'xxxx...x'
E         Right contains 112 more characters

astropy/io/fits/tests/test_card.py:88: AssertionError`,
    testsTotal: 7,
    analyses: [
      'The report says values over 68 chars get cut instead of being spread over CONTINUE cards. _format_value is in the traceback; checking how _use_continue is set.',
      '_use_continue is only set when parsing an existing CONTINUE card (line 433), never when formatting a fresh long value — so newly built cards truncate. The formatter should enable the convention itself.',
    ],
    summary:
      'Made _format_value enable the CONTINUE convention for any string longer than 68 characters instead of truncating. The roundtrip test passes and verification no longer raises.',
    failSummary:
      'Changed the truncation branch in _format_value, but the roundtrip still loses the tail: the writer path in _format_image applies its own 68-char slice, so the value is cut again downstream.',
  },
  {
    repo: 'pytest-dev/pytest',
    title: 'approx() comparison raises TypeError for numpy scalar inside plain dict',
    body: `>>> import numpy as np, pytest
>>> {'a': np.float64(0.1 + 0.2)} == pytest.approx({'a': 0.3})
Traceback (most recent call last):
  File "src/_pytest/python_api.py", line 141, in __eq__
    return all(self._yield_comparisons(actual))
  File "src/_pytest/python_api.py", line 258, in _yield_comparisons
    if set(actual.keys()) != set(self.expected.keys()):
TypeError: unhashable type: 'numpy.ndarray'

Only happens when numpy is installed and the dict value is a 0-d array.`,
    explores: [
      {
        cmd: "grep -rn '_yield_comparisons' src/_pytest/python_api.py | head -4",
        out: 'src/_pytest/python_api.py:141:        return all(self._yield_comparisons(actual))\nsrc/_pytest/python_api.py:252:    def _yield_comparisons(self, actual):\nsrc/_pytest/python_api.py:301:    def _yield_comparisons(self, actual):',
      },
      {
        cmd: "sed -n '250,268p' src/_pytest/python_api.py",
        out: `class ApproxMapping(ApproxBase):
    def _yield_comparisons(self, actual):
        if set(actual.keys()) != set(self.expected.keys()):
            raise _non_numeric_error(...)
        for k in self.expected.keys():
            yield actual[k], self.expected[k]`,
      },
      {
        cmd: 'ls testing/python',
        out: 'approx.py\ncollect.py\nfixtures.py\nintegration.py\nmetafunc.py\nraises.py',
      },
    ],
    editPath: 'src/_pytest/python_api.py',
    oldStr: `    def _yield_comparisons(self, actual):
        if set(actual.keys()) != set(self.expected.keys()):`,
    newStr: `    def _yield_comparisons(self, actual):
        if sorted(actual.keys(), key=repr) != sorted(self.expected.keys(), key=repr):`,
    testCmd: 'python -m pytest testing/python/approx.py -q -k numpy_scalar',
    testFile: 'testing/python/approx.py',
    testName: 'test_dict_with_numpy_scalar',
    failErr: `    def test_dict_with_numpy_scalar(self):
        import numpy as np
>       assert {'a': np.float64(0.30000000000000004)} == pytest.approx({'a': 0.3})
E       TypeError: unhashable type: 'numpy.ndarray'

testing/python/approx.py:612: TypeError`,
    testsTotal: 9,
    analyses: [
      'The TypeError comes from building a set over dict values? No — over keys, but a 0-d numpy array as a value gets pulled in through actual.keys() only if actual is itself an array-backed mapping. Reading the frame again: it is the keys() set comparison that trips when numpy overrides __eq__ on keys. Locating ApproxMapping.',
      'The set() comparison of keys relies on hashing and __eq__, and numpy scalars break that contract. Comparing sorted key reprs sidesteps hashing entirely and is order-stable for the error message.',
    ],
    summary:
      'Replaced the set-based key comparison in ApproxMapping with a hash-free sorted comparison. test_dict_with_numpy_scalar passes and the existing approx suite is unaffected.',
    failSummary:
      'Reworked the key comparison in ApproxMapping, but the TypeError persists — the same set() pattern exists in ApproxSequenceLike for mapping-like actuals, which is the branch this repro takes.',
  },
  {
    repo: 'scikit-learn/scikit-learn',
    title: 'StandardScaler.partial_fit overflows variance on constant int8 features',
    body: `partial_fit on int8 data with a constant column produces negative variance:

>>> import numpy as np
>>> from sklearn.preprocessing import StandardScaler
>>> X = np.full((1000, 1), 120, dtype=np.int8)
>>> s = StandardScaler()
>>> for i in range(0, 1000, 100): s.partial_fit(X[i:i+100])
>>> s.var_
array([-1.4e-12])

Traceback (with check_finite on):
  File "sklearn/utils/extmath.py", line 1051, in _incremental_mean_and_var
    updated_variance = (last_unnormalized_variance + new_unnormalized_variance + correction) / updated_sample_count
FloatingPointError: underflow encountered in divide`,
    explores: [
      {
        cmd: "grep -rn '_incremental_mean_and_var' sklearn/utils/extmath.py | head -3",
        out: 'sklearn/utils/extmath.py:986:def _incremental_mean_and_var(\nsklearn/utils/extmath.py:1051:    updated_variance = (last_unnormalized_variance + new_unnormalized_variance',
      },
      {
        cmd: "sed -n '1040,1058p' sklearn/utils/extmath.py",
        out: `    new_unnormalized_variance = X.var(axis=0) * new_sample_count
    last_over_new_count = last_sample_count / new_sample_count
    correction = (
        last_over_new_count / updated_sample_count
        * (last_sum / last_over_new_count - new_sum) ** 2
    )
    updated_variance = (last_unnormalized_variance + new_unnormalized_variance
                        + correction) / updated_sample_count`,
      },
      {
        cmd: "grep -rn 'partial_fit' sklearn/preprocessing/_data.py | head -4",
        out: 'sklearn/preprocessing/_data.py:871:    def partial_fit(self, X, y=None, sample_weight=None):\nsklearn/preprocessing/_data.py:907:        # incremental mean and var\nsklearn/preprocessing/_data.py:909:        self.mean_, self.var_, self.n_samples_seen_ = _incremental_mean_and_var(',
      },
    ],
    editPath: 'sklearn/utils/extmath.py',
    oldStr: `    updated_variance = (last_unnormalized_variance + new_unnormalized_variance
                        + correction) / updated_sample_count`,
    newStr: `    updated_variance = (last_unnormalized_variance + new_unnormalized_variance
                        + correction) / updated_sample_count
    # rounding in the pairwise correction can push exact-zero variance negative
    np.clip(updated_variance, 0, None, out=updated_variance)`,
    testCmd: 'python -m pytest sklearn/preprocessing/tests/test_data.py -q -k partial_fit_constant',
    testFile: 'sklearn/preprocessing/tests/test_data.py',
    testName: 'test_partial_fit_constant_int8',
    failErr: `    def test_partial_fit_constant_int8(self):
        X = np.full((1000, 1), 120, dtype=np.int8)
        s = StandardScaler()
        for i in range(0, 1000, 100):
            s.partial_fit(X[i : i + 100])
>       assert (s.var_ >= 0).all()
E       assert False
E        +  where False = array([-1.4210855e-12] >= 0).all()

sklearn/preprocessing/tests/test_data.py:2231: AssertionError`,
    testsTotal: 8,
    analyses: [
      'Negative variance from an incremental update is a classic catastrophic-cancellation symptom. The Chan et al. update in _incremental_mean_and_var must be producing a tiny negative residual for constant columns.',
      'The correction term is mathematically zero for a constant column, but in float64 it leaves ~1e-12 residue with either sign. Clamping the final variance at zero is the standard fix and matches what fit() already does via _handle_zeros_in_scale.',
    ],
    summary:
      'Clamped the incrementally-updated variance at zero in _incremental_mean_and_var, mirroring the batch path. The constant-int8 partial_fit test passes and transform no longer emits NaN.',
    failSummary:
      'Added a clamp after the variance update, but the test still fails: partial_fit casts back to the input dtype before the clamp runs, so the negative residue survives in var_.',
  },
  {
    repo: 'matplotlib/matplotlib',
    title: 'secondary_xaxis ignores functions pair when scale is log',
    body: `Creating a secondary axis with a (forward, inverse) functions pair on a
log-scaled parent silently falls back to identity:

    fig, ax = plt.subplots()
    ax.set_xscale('log')
    sec = ax.secondary_xaxis('top', functions=(np.sqrt, np.square))
    # sec ticks match ax ticks exactly — functions never applied

Traceback when validating:
  File "lib/matplotlib/axes/_secondary_axes.py", line 214, in _set_scale
    self._axis.set_scale('functionlog', functions=self._functions)
ValueError: scale 'functionlog' requires forward and inverse to be callables, got tuple`,
    explores: [
      {
        cmd: "grep -rn 'functionlog' lib/matplotlib/axes/_secondary_axes.py",
        out: "lib/matplotlib/axes/_secondary_axes.py:210:        if pscale == 'log':\nlib/matplotlib/axes/_secondary_axes.py:214:            self._axis.set_scale('functionlog', functions=self._functions)",
      },
      {
        cmd: "sed -n '205,222p' lib/matplotlib/axes/_secondary_axes.py",
        out: `    def _set_scale(self):
        pscale = self._parent.xaxis.get_scale()
        if pscale == 'log':
            defscale = 'functionlog'
            self._axis.set_scale('functionlog', functions=self._functions)
        else:
            defscale = 'function'
            self._axis.set_scale('function', functions=self._functions)`,
      },
      {
        cmd: "grep -rn 'class FuncScaleLog' lib/matplotlib/scale.py",
        out: 'lib/matplotlib/scale.py:512:class FuncScaleLog(LogScale):',
      },
      {
        cmd: "sed -n '512,528p' lib/matplotlib/scale.py",
        out: `class FuncScaleLog(LogScale):
    def __init__(self, axis, functions, base=10):
        forward, inverse = functions
        self.subs = None
        self._transform = FuncTransform(forward, inverse) + LogTransform(base)`,
      },
    ],
    editPath: 'lib/matplotlib/axes/_secondary_axes.py',
    oldStr: `        if pscale == 'log':
            defscale = 'functionlog'
            self._axis.set_scale('functionlog', functions=self._functions)`,
    newStr: `        if pscale == 'log':
            defscale = 'functionlog'
            self._axis.set_scale(
                'functionlog', functions=self._functions,
                base=self._parent.xaxis._scale.base,
            )`,
    testCmd: 'python -m pytest lib/matplotlib/tests/test_axes.py -q -k secondary_log',
    testFile: 'lib/matplotlib/tests/test_axes.py',
    testName: 'test_secondary_xaxis_functions_log',
    failErr: `    def test_secondary_xaxis_functions_log(self):
        sec = ax.secondary_xaxis('top', functions=(np.sqrt, np.square))
>       assert sec.get_xlim() == pytest.approx((1.0, 10.0))
E       assert (10.0, 100.0) == approx((1.0, 10.0))

lib/matplotlib/tests/test_axes.py:7741: AssertionError`,
    testsTotal: 4,
    analyses: [
      'The secondary axis has a scale dispatch in _set_scale; on log parents it uses functionlog. Checking how the functions tuple is forwarded there.',
      'FuncScaleLog defaults to base 10 and never receives the parent base, and the limits transform runs before the func pair on this path. Forwarding the parent base and letting FuncScaleLog unpack the tuple should align the pipelines.',
    ],
    summary:
      'Forwarded the parent log base into the functionlog scale in SecondaryAxis._set_scale. The transform pipeline now applies the functions pair and the secondary limits match the expected values.',
    failSummary:
      'Passed the parent base through to functionlog, but the secondary limits are still untransformed — _set_lims applies the identity transform cached before _set_scale runs, so the fix does not take effect.',
  },
  {
    repo: 'psf/requests',
    title: 'Session ignores per-request timeout when a transport adapter sets max_retries',
    body: `With an HTTPAdapter configured with max_retries=3, a per-request timeout is
dropped on retried requests:

    s = requests.Session()
    s.mount('https://', HTTPAdapter(max_retries=3))
    s.get('https://httpbin.org/delay/10', timeout=1)  # hangs ~30s

Traceback (KeyboardInterrupt during hang):
  File "requests/adapters.py", line 487, in send
    resp = conn.urlopen(
  File "urllib3/connectionpool.py", line 787, in urlopen
    retries = retries.increment(
  File "urllib3/connectionpool.py", line 941, in urlopen
    return self.urlopen(method, url, body=body, headers=headers, timeout=_DEFAULT_TIMEOUT, ...)`,
    explores: [
      {
        cmd: "grep -rn 'def send' requests/adapters.py",
        out: 'requests/adapters.py:434:    def send(',
      },
      {
        cmd: "sed -n '470,495p' requests/adapters.py",
        out: `        try:
            resp = conn.urlopen(
                method=request.method,
                url=url,
                body=request.body,
                headers=request.headers,
                redirect=False,
                assert_same_host=False,
                preload_content=False,
                decode_content=False,
                retries=self.max_retries,
                timeout=timeout,
            )`,
      },
      {
        cmd: "grep -rn 'TimeoutSauce' requests/adapters.py | head -4",
        out: 'requests/adapters.py:24:from .models import Response\nrequests/adapters.py:439:        if isinstance(timeout, tuple):\nrequests/adapters.py:447:            timeout = TimeoutSauce(connect=timeout, read=timeout)',
      },
      {
        cmd: "sed -n '439,452p' requests/adapters.py",
        out: `        if isinstance(timeout, tuple):
            try:
                connect, read = timeout
                timeout = TimeoutSauce(connect=connect, read=read)
            except ValueError:
                raise ValueError(...)
        elif isinstance(timeout, TimeoutSauce):
            pass
        else:
            timeout = TimeoutSauce(connect=timeout, read=timeout)`,
      },
    ],
    editPath: 'requests/adapters.py',
    oldStr: `        else:
            timeout = TimeoutSauce(connect=timeout, read=timeout)`,
    newStr: `        else:
            timeout = TimeoutSauce(connect=timeout, read=timeout, total=timeout)`,
    testCmd: 'python -m pytest tests/test_adapters.py -q -k retries_timeout',
    testFile: 'tests/test_adapters.py',
    testName: 'test_timeout_preserved_across_retries',
    failErr: `    def test_timeout_preserved_across_retries(self):
        with pytest.raises(requests.exceptions.ConnectTimeout):
>           s.get(mock_server.url, timeout=1)
E           Failed: DID NOT RAISE <class 'requests.exceptions.ConnectTimeout'>

tests/test_adapters.py:156: Failed`,
    testsTotal: 5,
    analyses: [
      'urllib3 resets timeout to _DEFAULT_TIMEOUT on the recursive retry call unless a total budget is set on the Timeout object. requests builds the TimeoutSauce without total, so only the first attempt is bounded.',
      'Setting total on the constructed TimeoutSauce gives urllib3 a cross-retry budget; the tuple branch may need the same treatment, but the scalar branch is what the repro hits.',
    ],
    summary:
      'Set a total budget on TimeoutSauce in HTTPAdapter.send so the per-request timeout survives urllib3 retries. The retry-timeout test now raises ConnectTimeout within the budget.',
    failSummary:
      'Added a total budget to the scalar timeout branch, but the hang persists in the test: the retry path re-enters send() with a fresh TimeoutSauce, discarding the accumulated budget.',
  },
  {
    repo: 'pallets/flask',
    title: 'url_for inside a blueprint-scoped error handler builds wrong endpoint prefix',
    body: `A 404 handler registered on a blueprint prefixes relative endpoints with the
blueprint name even when the failing URL did not match the blueprint:

    bp = Blueprint('admin', __name__, url_prefix='/admin')
    @bp.app_errorhandler(404)
    def nf(e):
        return redirect(url_for('.index'))

Traceback:
  File "src/flask/helpers.py", line 212, in url_for
    return current_app.url_for(endpoint, ...)
  File "src/flask/app.py", line 1123, in url_for
    endpoint = f"{blueprint_name}{endpoint}"
werkzeug.routing.exceptions.BuildError: Could not build url for endpoint 'admin.index'.`,
    explores: [
      {
        cmd: "grep -rn 'blueprint_name' src/flask/app.py | head -6",
        out: 'src/flask/app.py:1114:        blueprint_name = request.blueprint\nsrc/flask/app.py:1119:        if endpoint[:1] == ".":\nsrc/flask/app.py:1121:            if blueprint_name is not None:\nsrc/flask/app.py:1123:                endpoint = f"{blueprint_name}{endpoint}"',
      },
      {
        cmd: "sed -n '1110,1130p' src/flask/app.py",
        out: `    def url_for(self, endpoint, **values):
        req_ctx = _cv_request.get(None)
        if req_ctx is not None:
            blueprint_name = request.blueprint
            if endpoint[:1] == ".":
                if blueprint_name is not None:
                    endpoint = f"{blueprint_name}{endpoint}"
                else:
                    endpoint = endpoint[1:]`,
      },
      {
        cmd: "grep -rn 'app_errorhandler' src/flask/blueprints.py | head -3",
        out: 'src/flask/blueprints.py:404:    def app_errorhandler(self, code):\nsrc/flask/blueprints.py:409:        # handlers registered app-wide keep the blueprint as self.name',
      },
    ],
    editPath: 'src/flask/app.py',
    oldStr: `            blueprint_name = request.blueprint
            if endpoint[:1] == ".":`,
    newStr: `            blueprint_name = request.blueprint
            if blueprint_name is not None and blueprint_name not in self.blueprints:
                blueprint_name = None
            if endpoint[:1] == ".":`,
    testCmd: 'python -m pytest tests/test_blueprints.py -q -k errorhandler_url_for',
    testFile: 'tests/test_blueprints.py',
    testName: 'test_app_errorhandler_relative_url_for',
    failErr: `    def test_app_errorhandler_relative_url_for(self):
        rv = client.get('/admin/missing')
>       assert rv.headers['Location'] == '/'
E       werkzeug.routing.exceptions.BuildError: Could not build url for endpoint 'admin.index'. Did you mean 'index' instead?

tests/test_blueprints.py:451: BuildError`,
    testsTotal: 6,
    analyses: [
      'request.blueprint reflects the matched rule, but for a 404 there is no matched rule — it appears to inherit the blueprint from the handler registration instead. Checking the url_for endpoint resolution.',
      'url_for blindly prefixes a leading-dot endpoint with request.blueprint. For unmatched requests handled by app_errorhandler, that name may not correspond to a registered blueprint route. Guarding against stale names fixes the repro.',
    ],
    summary:
      'Guarded the blueprint prefix resolution in Flask.url_for against blueprint names that are not registered on the app. The blueprint error-handler test builds the correct root URL.',
    failSummary:
      'Added a guard in url_for, but the BuildError remains: the stale name comes from the request context push in full_dispatch_request, which reasserts the blueprint after the guard runs.',
  },
  {
    repo: 'numpy/numpy',
    title: 'np.unique(return_inverse=True) returns wrong dtype for empty structured arrays',
    body: `>>> import numpy as np
>>> a = np.empty(0, dtype=[('x', 'i4'), ('y', 'f8')])
>>> vals, inv = np.unique(a, return_inverse=True)
>>> inv.dtype
dtype('float64')

Expected an integer dtype (intp). Downstream code doing fancy indexing with
inv fails:

Traceback (most recent call last):
  File "repro.py", line 8, in <module>
    vals[inv]
IndexError: arrays used as indices must be of integer (or boolean) type`,
    explores: [
      {
        cmd: "grep -rn 'def unique' numpy/lib/arraysetops.py",
        out: 'numpy/lib/arraysetops.py:138:def unique(ar, return_index=False, return_inverse=False,',
      },
      {
        cmd: "sed -n '270,290p' numpy/lib/arraysetops.py",
        out: `    if return_inverse:
        imask = np.cumsum(mask) - 1
        inv_idx = np.empty(mask.shape, dtype=imask.dtype)
        inv_idx[perm] = imask
        ret += (inv_idx,)`,
      },
      {
        cmd: "grep -rn 'cumsum' numpy/lib/arraysetops.py | head -3",
        out: 'numpy/lib/arraysetops.py:271:        imask = np.cumsum(mask) - 1',
      },
    ],
    editPath: 'numpy/lib/arraysetops.py',
    oldStr: `        imask = np.cumsum(mask) - 1
        inv_idx = np.empty(mask.shape, dtype=imask.dtype)`,
    newStr: `        imask = np.cumsum(mask) - 1
        inv_idx = np.empty(mask.shape, dtype=np.intp)`,
    testCmd: 'python -m pytest numpy/lib/tests/test_arraysetops.py -q -k inverse_empty',
    testFile: 'numpy/lib/tests/test_arraysetops.py',
    testName: 'test_unique_inverse_empty_structured',
    failErr: `    def test_unique_inverse_empty_structured(self):
        a = np.empty(0, dtype=[('x', 'i4'), ('y', 'f8')])
        vals, inv = np.unique(a, return_inverse=True)
>       assert inv.dtype == np.intp
E       AssertionError: assert dtype('float64') == <class 'numpy.intp'>

numpy/lib/tests/test_arraysetops.py:301: AssertionError`,
    testsTotal: 7,
    analyses: [
      'For an empty input, cumsum over an empty mask produces a float64 array (sum of empty defaults), and inv_idx inherits that dtype. The dtype should be pinned to intp regardless of the mask contents.',
      'One-line fix: allocate inv_idx with dtype=np.intp instead of imask.dtype. Indexing semantics require an integer type in all cases.',
    ],
    summary:
      'Pinned the return_inverse index dtype to np.intp in np.unique, fixing the float64 escape on empty structured arrays. Fancy indexing with the inverse now works.',
    failSummary:
      'Pinned inv_idx to intp, but the test still sees float64: the empty-input fast path earlier in unique() returns before reaching the patched allocation.',
  },
  {
    repo: 'pydata/xarray',
    title: 'Dataset.mean(skipna=True) drops attrs even with keep_attrs=True',
    body: `>>> import xarray as xr, numpy as np
>>> ds = xr.Dataset({'t': ('x', [1.0, np.nan, 3.0], {'units': 'K'})})
>>> ds.mean(skipna=True, keep_attrs=True)['t'].attrs
{}

Expected {'units': 'K'}. Without skipna the attrs survive. Traceback when
strict attr checking is enabled:
  File "xarray/core/variable.py", line 1899, in reduce
    result = Variable(dims, data)
  File "xarray/core/variable.py", line 341, in __init__
    self._attrs = None
AttributeError: attrs lost during nanmean reduction`,
    explores: [
      {
        cmd: "grep -rn 'def reduce' xarray/core/variable.py | head -3",
        out: 'xarray/core/variable.py:1860:    def reduce(',
      },
      {
        cmd: "sed -n '1885,1905p' xarray/core/variable.py",
        out: `        if skipna or (skipna is None and self.dtype.kind in 'cfO'):
            nanname = 'nan' + func.__name__
            func = getattr(duck_array_ops, nanname)
            data = func(self.data, axis=axis, **kwargs)
            return Variable(dims, data)
        ...
        keep = _get_keep_attrs(keep_attrs)
        attrs = self._attrs if keep else None
        return Variable(dims, data, attrs=attrs)`,
      },
      {
        cmd: "grep -rn '_get_keep_attrs' xarray/core/variable.py | head -3",
        out: 'xarray/core/variable.py:33:from xarray.core.options import _get_keep_attrs\nxarray/core/variable.py:1896:        keep = _get_keep_attrs(keep_attrs)',
      },
    ],
    editPath: 'xarray/core/variable.py',
    oldStr: `            data = func(self.data, axis=axis, **kwargs)
            return Variable(dims, data)`,
    newStr: `            data = func(self.data, axis=axis, **kwargs)
            keep = _get_keep_attrs(keep_attrs)
            return Variable(dims, data, attrs=self._attrs if keep else None)`,
    testCmd: 'python -m pytest xarray/tests/test_variable.py -q -k keep_attrs_skipna',
    testFile: 'xarray/tests/test_variable.py',
    testName: 'test_reduce_keep_attrs_skipna',
    failErr: `    def test_reduce_keep_attrs_skipna(self):
        v = Variable('x', [1.0, np.nan], attrs={'units': 'K'})
>       assert v.mean(skipna=True, keep_attrs=True).attrs == {'units': 'K'}
E       AssertionError: assert {} == {'units': 'K'}

xarray/tests/test_variable.py:1744: AssertionError`,
    testsTotal: 6,
    analyses: [
      'The skipna branch dispatches to the nan-aware reduction and returns early — before the keep_attrs handling that the non-skipna branch performs. That early return is the bug.',
      'The fix is to apply the same _get_keep_attrs logic on the early-return path so both branches construct the Variable identically.',
    ],
    summary:
      'Applied keep_attrs handling on the skipna early-return path of Variable.reduce. Attrs now survive nanmean and the regression test passes.',
    failSummary:
      'Patched the skipna branch in Variable.reduce, but Dataset.mean still drops attrs — the Dataset-level reduce re-wraps the result Variable and discards attrs a second time.',
  },
]

export const SWE_EXTRA_ANALYSES: readonly string[] = [
  'Before editing, re-running the failing selector to capture the exact assertion text for comparison after the fix.',
  'The surrounding module has no test for this branch; the verified suite ships one, so running it first to see the red state.',
  'Scanning for other call sites of this helper to make sure the change cannot regress a sibling code path.',
  'The diff should stay minimal: touch only the guard, keep formatting identical so the review surface is one hunk.',
]

// ---------------------------------------------------------------------------
// terminal/terminal-bench
// ---------------------------------------------------------------------------

export interface TermRound {
  cmd: string
  out: string
}

export interface TermItem {
  task: string
  rounds: TermRound[]
  checkCmd: string
  checkPass: string
  checkFail: string
  summary: string
  failSummary: string
}

export const TERM_ANALYSES: readonly string[] = [
  'Surveying the current state before mutating anything — destructive steps come last.',
  'The output confirms the hypothesis; proceeding with the next command in the plan.',
  'That result is larger than expected. Narrowing the scope before acting on it.',
  'Dry-running the destructive step with a list-only flag first.',
  'Verifying the change took effect before declaring the task done.',
]

export const TERM_ITEMS: readonly TermItem[] = [
  {
    task: 'Disk usage on /var/log is at 92%. Compress every *.log file older than 7 days under /var/log/app (keep newer ones untouched) and verify usage drops below 80%.',
    rounds: [
      {
        cmd: 'df -h /var/log',
        out: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda2        20G   18G  1.6G  92% /var/log',
      },
      { cmd: 'du -sh /var/log/app', out: '14G\t/var/log/app' },
      {
        cmd: "find /var/log/app -name '*.log' -mtime +7 | head -5",
        out: '/var/log/app/app-2026-02-11.log\n/var/log/app/app-2026-02-12.log\n/var/log/app/app-2026-02-13.log\n/var/log/app/app-2026-02-14.log\n/var/log/app/app-2026-02-15.log',
      },
      { cmd: "find /var/log/app -name '*.log' -mtime +7 | wc -l", out: '214' },
      { cmd: "find /var/log/app -name '*.log' -mtime +7 -exec gzip -9 {} +", out: '' },
      {
        cmd: 'ls -lh /var/log/app | head -4',
        out: 'total 4.1G\n-rw-r--r-- 1 app app 118M Feb 11 03:11 app-2026-02-11.log.gz\n-rw-r--r-- 1 app app 121M Feb 12 03:14 app-2026-02-12.log.gz\n-rw-r--r-- 1 app app 2.1G Feb 28 09:52 app-2026-02-28.log',
      },
      {
        cmd: 'df -h /var/log',
        out: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda2        20G   13G  6.6G  67% /var/log',
      },
    ],
    checkCmd: "df --output=pcent /var/log | tail -1 | tr -d ' %'",
    checkPass: '67',
    checkFail: '91',
    summary:
      'Compressed 214 log files older than 7 days under /var/log/app with gzip -9. Usage dropped from 92% to 67%, below the 80% target; files newer than 7 days were left untouched.',
    failSummary:
      'Compressed the aged logs, but usage only reached 91% — the bulk of the space is in a 2.1G current log that the age filter correctly skips, so the target was not met.',
  },
  {
    task: 'Find every file larger than 500MB under /data, report owner and age for each, and move any that have not been accessed in 90 days to /data/cold/.',
    rounds: [
      {
        cmd: 'find /data -xdev -type f -size +500M -printf "%s\\t%u\\t%TY-%Tm-%Td\\t%p\\n" | sort -rn | head',
        out: '9126805504\tetl\t2025-11-02\t/data/warehouse/events-2025-q3.parquet\n4831838208\tetl\t2025-12-19\t/data/warehouse/events-2025-q4.parquet\n2147483648\tml\t2026-01-08\t/data/models/ckpt-0150.pt\n1610612736\tml\t2026-02-21\t/data/models/ckpt-0300.pt\n734003200\tbackup\t2025-10-30\t/data/dumps/pg-full-oct.sql',
      },
      { cmd: 'find /data -xdev -type f -size +500M | wc -l', out: '5' },
      {
        cmd: 'find /data -xdev -type f -size +500M -atime +90',
        out: '/data/warehouse/events-2025-q3.parquet\n/data/dumps/pg-full-oct.sql',
      },
      { cmd: 'mkdir -p /data/cold', out: '' },
      {
        cmd: 'find /data -xdev -type f -size +500M -atime +90 -exec mv -v {} /data/cold/ \\;',
        out: "renamed '/data/warehouse/events-2025-q3.parquet' -> '/data/cold/events-2025-q3.parquet'\nrenamed '/data/dumps/pg-full-oct.sql' -> '/data/cold/pg-full-oct.sql'",
      },
      {
        cmd: 'ls -lh /data/cold',
        out: 'total 9.2G\n-rw-r--r-- 1 etl  etl  8.5G Nov  2 04:12 events-2025-q3.parquet\n-rw-r--r-- 1 backup backup 700M Oct 30 02:00 pg-full-oct.sql',
      },
    ],
    checkCmd: 'ls /data/cold | wc -l',
    checkPass: '2',
    checkFail: '0',
    summary:
      'Found 5 files over 500MB under /data; two had not been accessed in 90+ days (a Q3 parquet and an October pg dump) and were moved to /data/cold/ with ownership preserved.',
    failSummary:
      'Identified the oversized files, but the move step targeted /data/cold before creating it and mv failed; /data/cold is empty so the checker fails.',
  },
  {
    task: "The nightly backup cron on this host stopped firing after a config edit. Find the broken entry in /etc/cron.d and fix it so root's backup.sh runs daily at 02:30.",
    rounds: [
      { cmd: 'ls /etc/cron.d', out: 'backup\ncertbot\nsysstat' },
      {
        cmd: 'cat /etc/cron.d/backup',
        out: '# m h dom mon dow user command\n30 2 * * * /usr/local/bin/backup.sh --full',
      },
      {
        cmd: 'grep -i cron /var/log/syslog | tail -3',
        out: 'Feb 28 02:30:01 host cron[812]: Error: bad username; while reading /etc/cron.d/backup\nFeb 28 02:30:01 host cron[812]: (*system*backup) ERROR (Syntax error, this crontab file will be ignored)\nFeb 28 03:00:01 host CRON[9871]: (root) CMD (/usr/lib/sysstat/sa1 1 1)',
      },
      {
        cmd: "sed -i 's|^30 2 \\* \\* \\* /usr|30 2 * * * root /usr|' /etc/cron.d/backup",
        out: '',
      },
      {
        cmd: 'cat /etc/cron.d/backup',
        out: '# m h dom mon dow user command\n30 2 * * * root /usr/local/bin/backup.sh --full',
      },
      { cmd: 'systemctl reload cron', out: '' },
      {
        cmd: 'grep -i "backup" /var/log/syslog | tail -1',
        out: 'Feb 28 09:14:22 host cron[812]: (*system*backup) RELOAD (/etc/cron.d/backup)',
      },
    ],
    checkCmd: "awk '{print $6}' /etc/cron.d/backup | tail -1",
    checkPass: 'root',
    checkFail: '/usr/local/bin/backup.sh',
    summary:
      'The /etc/cron.d/backup entry was missing the mandatory user field, so cron rejected the whole file. Re-inserted "root" after the schedule, reloaded cron, and the file now parses.',
    failSummary:
      'Edited the cron entry but the sed expression did not match the line (the schedule uses tabs, not spaces), so the file is unchanged and cron still ignores it.',
  },
  {
    task: 'A teammate force-pushed over main in the deploy repo at /srv/deploy. Recover the previous main (commit is still in reflog), create branch rescue/main from it, and push it to origin.',
    rounds: [
      {
        cmd: 'cd /srv/deploy && git log --oneline -3',
        out: 'f3a91c2 hotfix: bump image tag\n8c17d4e ci: pin runner\n41b0aa9 initial rollout config',
      },
      {
        cmd: 'cd /srv/deploy && git reflog | head -6',
        out: 'f3a91c2 HEAD@{0}: pull --rebase: fast-forward\n2e9d7b1 HEAD@{1}: checkout: moving from main to main\n2e9d7b1 HEAD@{2}: commit: release: v2026.02.4\n9b42f70 HEAD@{3}: commit: config: raise HPA ceiling\n8c17d4e HEAD@{4}: pull: fast-forward\n41b0aa9 HEAD@{5}: clone: from origin',
      },
      {
        cmd: 'cd /srv/deploy && git show --stat 2e9d7b1 | head -5',
        out: 'commit 2e9d7b1f0c8a4d21be6a90c3d4a7e551c92f8d17\nAuthor: R. Ortega <ro@corp.example>\nDate:   Thu Feb 26 17:41:09 2026 +0000\n\n    release: v2026.02.4',
      },
      { cmd: 'cd /srv/deploy && git branch rescue/main 2e9d7b1', out: '' },
      {
        cmd: 'cd /srv/deploy && git push -u origin rescue/main',
        out: "To github.example:infra/deploy.git\n * [new branch]      rescue/main -> rescue/main\nbranch 'rescue/main' set up to track 'origin/rescue/main'.",
      },
      {
        cmd: 'cd /srv/deploy && git branch -a | grep rescue',
        out: '  rescue/main\n  remotes/origin/rescue/main',
      },
    ],
    checkCmd: 'cd /srv/deploy && git rev-parse --short rescue/main',
    checkPass: '2e9d7b1',
    checkFail: 'fatal: ambiguous argument',
    summary:
      'Recovered the overwritten main from the reflog (2e9d7b1, "release: v2026.02.4"), created rescue/main pointing at it, and pushed the branch to origin with tracking.',
    failSummary:
      'Located the lost commit in the reflog but created the branch from HEAD@{1} of the wrong checkout line; rescue/main points at the force-pushed tip, not the lost release commit.',
  },
  {
    task: 'nginx access logs on this box are unrotated and 8GB. Set up logrotate for /var/log/nginx/*.log (daily, 14 rotations, compress, reload nginx post-rotate) and force one rotation now.',
    rounds: [
      {
        cmd: 'ls -lh /var/log/nginx/',
        out: 'total 8.2G\n-rw-r----- 1 www-data adm 7.6G Feb 28 10:02 access.log\n-rw-r----- 1 www-data adm 601M Feb 28 10:02 error.log',
      },
      { cmd: 'ls /etc/logrotate.d/ | head', out: 'apt\ndpkg\nrsyslog\nufw' },
      {
        cmd: "cat > /etc/logrotate.d/nginx <<'EOF'\n/var/log/nginx/*.log {\n    daily\n    rotate 14\n    compress\n    delaycompress\n    missingok\n    notifempty\n    create 0640 www-data adm\n    sharedscripts\n    postrotate\n        systemctl reload nginx\n    endscript\n}\nEOF",
        out: '',
      },
      {
        cmd: 'logrotate -d /etc/logrotate.d/nginx 2>&1 | tail -4',
        out: 'rotating pattern: /var/log/nginx/*.log  after 1 days (14 rotations)\nconsidering log /var/log/nginx/access.log\n  log needs rotating\nconsidering log /var/log/nginx/error.log',
      },
      { cmd: 'logrotate -f /etc/logrotate.d/nginx', out: '' },
      {
        cmd: 'ls -lh /var/log/nginx/',
        out: 'total 1.3G\n-rw-r----- 1 www-data adm    0 Feb 28 10:05 access.log\n-rw-r----- 1 www-data adm 7.6G Feb 28 10:05 access.log.1\n-rw-r----- 1 www-data adm    0 Feb 28 10:05 error.log\n-rw-r----- 1 www-data adm 601M Feb 28 10:05 error.log.1',
      },
    ],
    checkCmd: 'test -f /etc/logrotate.d/nginx && test -f /var/log/nginx/access.log.1 && echo ok',
    checkPass: 'ok',
    checkFail: '',
    summary:
      'Installed /etc/logrotate.d/nginx with daily rotation, 14 kept rotations, compression and an nginx reload in postrotate; dry-run validated the config and a forced rotation moved the 7.6G access log aside.',
    failSummary:
      'Wrote the logrotate stanza, but the forced rotation failed: the postrotate reload references a unit name not present on this host, and logrotate aborted before renaming the files.',
  },
  {
    task: 'Something is intermittently filling / on this CI runner. Find the top space consumers outside /home, clean anything safely reclaimable (apt cache, journal older than 3 days, dangling docker images), and report space freed.',
    rounds: [
      {
        cmd: 'df -h /',
        out: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/root        58G   53G  4.2G  93% /',
      },
      {
        cmd: 'du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -8',
        out: '53G\t/\n21G\t/var/lib/docker\n12G\t/var/lib/docker/overlay2\n8.9G\t/var/cache/apt\n6.1G\t/var/log/journal\n4.0G\t/opt/hostedtoolcache\n2.2G\t/usr/lib\n1.9G\t/var/lib/docker/volumes',
      },
      { cmd: 'apt-get clean && du -sh /var/cache/apt', out: '24K\t/var/cache/apt' },
      {
        cmd: 'journalctl --vacuum-time=3d',
        out: 'Deleted archived journal /var/log/journal/…/system@0006119.journal (512.0M).\nVacuuming done, freed 5.4G of archived journals from /var/log/journal.',
      },
      {
        cmd: 'docker image prune -f',
        out: 'Deleted Images:\ndeleted: sha256:41f5c9b2…\ndeleted: sha256:9ac07d13…\n\nTotal reclaimed space: 9.8GB',
      },
      {
        cmd: 'df -h /',
        out: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/root        58G   29G   28G  52% /',
      },
    ],
    checkCmd: "df --output=pcent / | tail -1 | tr -d ' %'",
    checkPass: '52',
    checkFail: '93',
    summary:
      'Top consumers were docker overlay2 (12G), apt cache (8.9G) and journald (6.1G). apt-get clean, a 3-day journal vacuum and a docker image prune freed ~24G, taking / from 93% to 52%.',
    failSummary:
      'Cleaned apt and journald, but docker prune was skipped because the daemon socket is not accessible from this shell; / is still at 93% and the checker fails.',
  },
  {
    task: 'Port 8080 on this host is owned by a zombie deploy of the api service. Identify the process, capture its command line for the incident note, terminate it gracefully (SIGTERM, then SIGKILL only if needed), and confirm the port is free.',
    rounds: [
      {
        cmd: 'ss -ltnp | grep :8080',
        out: 'LISTEN 0      4096         0.0.0.0:8080      0.0.0.0:*    users:(("gunicorn",pid=21744,fd=5),("gunicorn",pid=21745,fd=5))',
      },
      {
        cmd: 'ps -o pid,ppid,etime,cmd -p 21744,21745',
        out: '  PID  PPID     ELAPSED CMD\n21744     1  6-04:12:33 gunicorn: master [api:app]\n21745 21744  6-04:12:33 gunicorn: worker [api:app]',
      },
      { cmd: 'kill -TERM 21744', out: '' },
      {
        cmd: 'sleep 5; ps -p 21744 -o pid,stat,cmd',
        out: '  PID STAT CMD\n21744 Zl   gunicorn: master [api:app]',
      },
      { cmd: 'kill -KILL 21744 21745', out: '' },
      { cmd: 'ss -ltnp | grep :8080 || echo free', out: 'free' },
    ],
    checkCmd: 'ss -ltn sport = :8080 | tail -n +2 | wc -l',
    checkPass: '0',
    checkFail: '1',
    summary:
      'Port 8080 was held by an orphaned gunicorn master (pid 21744, up 6 days, reparented to init). SIGTERM left it zombied, so it was SIGKILLed along with its worker; the port is now free.',
    failSummary:
      'Sent SIGTERM to the worker instead of the master; the master respawned a new worker and re-bound the port, so 8080 is still occupied.',
  },
  {
    task: 'Offboard user "jmalik": archive /home/jmalik to /backup/offboard/jmalik-home.tar.zst, lock the account, and remove their authorized_keys, leaving the home dir in place for legal hold.',
    rounds: [
      { cmd: 'du -sh /home/jmalik', out: '3.4G\t/home/jmalik' },
      { cmd: 'mkdir -p /backup/offboard', out: '' },
      {
        cmd: 'tar --zstd -cf /backup/offboard/jmalik-home.tar.zst -C /home jmalik',
        out: '',
      },
      {
        cmd: 'ls -lh /backup/offboard/',
        out: 'total 1.9G\n-rw-r--r-- 1 root root 1.9G Feb 28 11:03 jmalik-home.tar.zst',
      },
      { cmd: 'usermod --lock jmalik && chage -E 0 jmalik', out: '' },
      {
        cmd: 'passwd -S jmalik',
        out: 'jmalik L 2026-02-28 0 99999 7 -1 (Password locked.)',
      },
      {
        cmd: 'rm -f /home/jmalik/.ssh/authorized_keys && ls /home/jmalik/.ssh/',
        out: 'known_hosts',
      },
    ],
    checkCmd: "passwd -S jmalik | awk '{print $2}'",
    checkPass: 'L',
    checkFail: 'P',
    summary:
      'Archived /home/jmalik (3.4G -> 1.9G zstd) to /backup/offboard, locked the account and expired it, and removed authorized_keys while leaving the home directory intact for legal hold.',
    failSummary:
      'Created the archive, but usermod --lock was run against jmailk (typo); the account still shows P in passwd -S and the checker fails.',
  },
  {
    task: 'The app at /srv/www must be owned by www-data:www-data with directories 750 and files 640, but a bad rsync flattened everything to 777 under root. Fix ownership and permissions recursively and verify.',
    rounds: [
      {
        cmd: 'stat -c "%U:%G %a %n" /srv/www /srv/www/index.php',
        out: 'root:root 777 /srv/www\nroot:root 777 /srv/www/index.php',
      },
      { cmd: 'find /srv/www -type f | wc -l; find /srv/www -type d | wc -l', out: '4211\n386' },
      { cmd: 'chown -R www-data:www-data /srv/www', out: '' },
      { cmd: 'find /srv/www -type d -exec chmod 750 {} +', out: '' },
      { cmd: 'find /srv/www -type f -exec chmod 640 {} +', out: '' },
      {
        cmd: 'stat -c "%U:%G %a %n" /srv/www /srv/www/index.php',
        out: 'www-data:www-data 750 /srv/www\nwww-data:www-data 640 /srv/www/index.php',
      },
      { cmd: 'find /srv/www -perm /o+w | wc -l', out: '0' },
    ],
    checkCmd: 'find /srv/www -perm /o+w | wc -l',
    checkPass: '0',
    checkFail: '4211',
    summary:
      'Reset ownership of 4,597 entries under /srv/www to www-data:www-data, set directories to 750 and files to 640, and verified no world-writable paths remain.',
    failSummary:
      'Ran the chmod pass but with -type f and -type d swapped, leaving directories 640 (unreadable) and files 750; world-writable check passes but the site is broken and ownership was never changed.',
  },
  {
    task: 'A migration left thousands of empty directories and zero-byte .tmp files under /srv/uploads. Remove both (depth-first for the dirs), but do not touch non-empty files, and report counts removed.',
    rounds: [
      { cmd: "find /srv/uploads -type f -name '*.tmp' -size 0 | wc -l", out: '18342' },
      { cmd: 'find /srv/uploads -type d -empty | wc -l', out: '2201' },
      {
        cmd: "find /srv/uploads -type f -name '*.tmp' -size 0 -print -delete | tail -3",
        out: '/srv/uploads/2025/11/30/upload-9911.tmp\n/srv/uploads/2025/11/30/upload-9912.tmp\n/srv/uploads/2025/12/01/upload-0003.tmp',
      },
      { cmd: 'find /srv/uploads -depth -type d -empty -delete', out: '' },
      { cmd: "find /srv/uploads -type f -name '*.tmp' -size 0 | wc -l", out: '0' },
      { cmd: 'find /srv/uploads -type d -empty | wc -l', out: '0' },
      { cmd: 'find /srv/uploads -type f | wc -l', out: '95410' },
    ],
    checkCmd: 'find /srv/uploads -type d -empty -o -type f -name "*.tmp" -size 0 | wc -l',
    checkPass: '0',
    checkFail: '2201',
    summary:
      'Removed 18,342 zero-byte .tmp files and 2,201 empty directories under /srv/uploads using a depth-first delete; the 95,410 real upload files are untouched.',
    failSummary:
      'Deleted the .tmp files, but the directory pass ran without -depth so parent directories that became empty were skipped; 2,201 empty dirs remain.',
  },
]

// ---------------------------------------------------------------------------
// code/leetcode
// ---------------------------------------------------------------------------

export interface LeetItem {
  title: string
  statement: string
  solution: string
  buggy: string
  casesTotal: number
  failNote: string
  /** One-line expected-behavior summary, surfaced as meta.extra.ground_truth. */
  groundTruth: string
}

export const LEET_ANALYSES: readonly string[] = [
  'Constraints are small enough that the obvious approach fits, but the follow-up asks for the optimal one; going straight to it.',
  'Key invariant: the data structure state after processing prefix i fully determines the answer for i+1.',
  'Edge cases to cover before submitting: empty input, single element, and the all-duplicates case.',
  'Complexity check: one pass, O(n) time, O(n) auxiliary space for the map. That meets the constraint.',
  'Writing the solution, then tracing it on the first example to confirm indices are handled correctly.',
]

export const LEET_ITEMS: readonly LeetItem[] = [
  {
    title: 'Two Sum',
    statement:
      'Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target. Exactly one solution exists, and you may not use the same element twice. Return the answer in any order.\n\nExample: nums = [2,7,11,15], target = 9 -> [0,1]\nConstraints: 2 <= len(nums) <= 10^4, -10^9 <= nums[i], target <= 10^9.',
    solution:
      'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n        return []',
    buggy:
      'class Solution:\n    def twoSum(self, nums: list[int], target: int) -> list[int]:\n        seen = {}\n        for i, x in enumerate(nums):\n            seen[x] = i\n            if target - x in seen:\n                return [seen[target - x], i]\n        return []',
    casesTotal: 10,
    failNote: 'expected [0, 3], got [3, 3] (element reused when target == 2*nums[i])',
    groundTruth:
      'Returns indices i != j with nums[i] + nums[j] == target; the same element must not be used twice.',
  },
  {
    title: 'Valid Parentheses',
    statement:
      "Given a string s containing just the characters '()', '{}' and '[]', determine if the input string is valid: open brackets must be closed by the same type in the correct order, and every close bracket has a matching open.\n\nExample: s = '([{}])' -> true; s = '(]' -> false.\nConstraints: 1 <= len(s) <= 10^4.",
    solution:
      "class Solution:\n    def isValid(self, s: str) -> bool:\n        pairs = {')': '(', ']': '[', '}': '{'}\n        stack = []\n        for ch in s:\n            if ch in pairs:\n                if not stack or stack.pop() != pairs[ch]:\n                    return False\n            else:\n                stack.append(ch)\n        return not stack",
    buggy:
      "class Solution:\n    def isValid(self, s: str) -> bool:\n        pairs = {')': '(', ']': '[', '}': '{'}\n        stack = []\n        for ch in s:\n            if ch in pairs:\n                if stack and stack.pop() != pairs[ch]:\n                    return False\n            else:\n                stack.append(ch)\n        return not stack",
    casesTotal: 8,
    failNote: "expected False, got True on s = ']' (empty-stack close accepted)",
    groundTruth:
      'Returns true iff every bracket closes the matching type in order, rejecting any close on an empty stack.',
  },
  {
    title: 'Merge Intervals',
    statement:
      'Given an array of intervals where intervals[i] = [start_i, end_i], merge all overlapping intervals and return an array of the non-overlapping intervals that cover all the intervals in the input.\n\nExample: [[1,3],[2,6],[8,10],[15,18]] -> [[1,6],[8,10],[15,18]].\nConstraints: 1 <= len(intervals) <= 10^4.',
    solution:
      'class Solution:\n    def merge(self, intervals: list[list[int]]) -> list[list[int]]:\n        intervals.sort()\n        out = [intervals[0][:]]\n        for s, e in intervals[1:]:\n            if s <= out[-1][1]:\n                out[-1][1] = max(out[-1][1], e)\n            else:\n                out.append([s, e])\n        return out',
    buggy:
      'class Solution:\n    def merge(self, intervals: list[list[int]]) -> list[list[int]]:\n        intervals.sort()\n        out = [intervals[0][:]]\n        for s, e in intervals[1:]:\n            if s < out[-1][1]:\n                out[-1][1] = max(out[-1][1], e)\n            else:\n                out.append([s, e])\n        return out',
    casesTotal: 9,
    failNote: 'expected [[1,5]], got [[1,4],[4,5]] (touching intervals not merged)',
    groundTruth:
      'Returns non-overlapping intervals covering the input; overlapping and touching intervals (shared endpoint) merge.',
  },
  {
    title: 'Longest Substring Without Repeating Characters',
    statement:
      "Given a string s, find the length of the longest substring without duplicate characters.\n\nExample: s = 'abcabcbb' -> 3 ('abc'). s = 'bbbbb' -> 1.\nConstraints: 0 <= len(s) <= 5 * 10^4; s consists of English letters, digits, symbols and spaces.",
    solution:
      'class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        last = {}\n        best = left = 0\n        for i, ch in enumerate(s):\n            if ch in last and last[ch] >= left:\n                left = last[ch] + 1\n            last[ch] = i\n            best = max(best, i - left + 1)\n        return best',
    buggy:
      'class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        last = {}\n        best = left = 0\n        for i, ch in enumerate(s):\n            if ch in last:\n                left = last[ch] + 1\n            last[ch] = i\n            best = max(best, i - left + 1)\n        return best',
    casesTotal: 10,
    failNote: "expected 3, got 2 on s = 'abba' (stale window start moves left backwards)",
    groundTruth:
      'Returns the length of the longest substring without repeated characters; the sliding-window start must never move backwards on a stale duplicate.',
  },
  {
    title: 'Best Time to Buy and Sell Stock',
    statement:
      'You are given an array prices where prices[i] is the price of a stock on day i. Choose a single day to buy and a later day to sell to maximize profit. Return the maximum profit, or 0 if no profit is possible.\n\nExample: prices = [7,1,5,3,6,4] -> 5 (buy at 1, sell at 6).\nConstraints: 1 <= len(prices) <= 10^5.',
    solution:
      'class Solution:\n    def maxProfit(self, prices: list[int]) -> int:\n        best = 0\n        lo = prices[0]\n        for p in prices[1:]:\n            best = max(best, p - lo)\n            lo = min(lo, p)\n        return best',
    buggy:
      'class Solution:\n    def maxProfit(self, prices: list[int]) -> int:\n        best = 0\n        lo = prices[0]\n        for p in prices[1:]:\n            lo = min(lo, p)\n            best = max(best, p - lo)\n        return best',
    casesTotal: 8,
    failNote:
      'expected 0, got 0 on decreasing input but expected 4, got 5 on [2,1,5] variants (buy/sell same day allowed)',
    groundTruth:
      'Returns the maximum of prices[j] - prices[i] over j > i, or 0 when no profitable pair exists; buying and selling on the same day is not allowed.',
  },
  {
    title: 'Product of Array Except Self',
    statement:
      'Given an integer array nums, return an array answer such that answer[i] equals the product of all elements of nums except nums[i]. You must write an O(n) algorithm without using division.\n\nExample: nums = [1,2,3,4] -> [24,12,8,6].\nConstraints: 2 <= len(nums) <= 10^5.',
    solution:
      'class Solution:\n    def productExceptSelf(self, nums: list[int]) -> list[int]:\n        n = len(nums)\n        out = [1] * n\n        left = 1\n        for i in range(n):\n            out[i] = left\n            left *= nums[i]\n        right = 1\n        for i in range(n - 1, -1, -1):\n            out[i] *= right\n            right *= nums[i]\n        return out',
    buggy:
      'class Solution:\n    def productExceptSelf(self, nums: list[int]) -> list[int]:\n        n = len(nums)\n        out = [1] * n\n        left = 1\n        for i in range(n):\n            left *= nums[i]\n            out[i] = left\n        right = 1\n        for i in range(n - 1, -1, -1):\n            out[i] *= right\n            right *= nums[i]\n        return out',
    casesTotal: 9,
    failNote: 'expected [24,12,8,6], got [24,24,16,12] (prefix product includes self)',
    groundTruth:
      'answer[i] equals the product of all elements except nums[i], in O(n) without division; the prefix pass must exclude the current element.',
  },
  {
    title: 'Binary Search',
    statement:
      'Given a sorted (ascending) array of distinct integers nums and a target, return the index of target if it exists, otherwise -1. You must write an algorithm with O(log n) runtime.\n\nExample: nums = [-1,0,3,5,9,12], target = 9 -> 4.\nConstraints: 1 <= len(nums) <= 10^4.',
    solution:
      'class Solution:\n    def search(self, nums: list[int], target: int) -> int:\n        lo, hi = 0, len(nums) - 1\n        while lo <= hi:\n            mid = (lo + hi) // 2\n            if nums[mid] == target:\n                return mid\n            if nums[mid] < target:\n                lo = mid + 1\n            else:\n                hi = mid - 1\n        return -1',
    buggy:
      'class Solution:\n    def search(self, nums: list[int], target: int) -> int:\n        lo, hi = 0, len(nums) - 1\n        while lo < hi:\n            mid = (lo + hi) // 2\n            if nums[mid] == target:\n                return mid\n            if nums[mid] < target:\n                lo = mid + 1\n            else:\n                hi = mid - 1\n        return -1',
    casesTotal: 10,
    failNote: 'expected 0, got -1 on single-element array (loop exits before checking lo == hi)',
    groundTruth:
      'Returns the index of target in the sorted array or -1, in O(log n); must handle the lo == hi case (single-element array).',
  },
  {
    title: 'Climbing Stairs',
    statement:
      'You are climbing a staircase with n steps. Each time you can climb 1 or 2 steps. In how many distinct ways can you reach the top?\n\nExample: n = 3 -> 3 (1+1+1, 1+2, 2+1).\nConstraints: 1 <= n <= 45.',
    solution:
      'class Solution:\n    def climbStairs(self, n: int) -> int:\n        a, b = 1, 1\n        for _ in range(n - 1):\n            a, b = b, a + b\n        return b',
    buggy:
      'class Solution:\n    def climbStairs(self, n: int) -> int:\n        a, b = 1, 1\n        for _ in range(n):\n            a, b = b, a + b\n        return b',
    casesTotal: 8,
    failNote: 'expected 2, got 3 on n = 2 (off-by-one in iteration count)',
    groundTruth:
      'Returns the number of distinct 1-or-2-step compositions of n (Fibonacci sequence with climbStairs(1) = 1, climbStairs(2) = 2).',
  },
  {
    title: 'Group Anagrams',
    statement:
      "Given an array of strings strs, group the anagrams together. You may return the answer in any order.\n\nExample: ['eat','tea','tan','ate','nat','bat'] -> [['eat','tea','ate'],['tan','nat'],['bat']].\nConstraints: 1 <= len(strs) <= 10^4, strs[i] consists of lowercase English letters.",
    solution:
      "class Solution:\n    def groupAnagrams(self, strs: list[str]) -> list[list[str]]:\n        groups: dict[str, list[str]] = {}\n        for s in strs:\n            key = ''.join(sorted(s))\n            groups.setdefault(key, []).append(s)\n        return list(groups.values())",
    buggy:
      'class Solution:\n    def groupAnagrams(self, strs: list[str]) -> list[list[str]]:\n        groups: dict[int, list[str]] = {}\n        for s in strs:\n            key = sum(ord(c) for c in s)\n            groups.setdefault(key, []).append(s)\n        return list(groups.values())',
    casesTotal: 9,
    failNote: "expected separate groups, got ['ac','bb'] merged (character-sum key collides)",
    groundTruth:
      "Groups strings that are exact anagrams (identical character multisets); non-anagrams with colliding character sums like 'ac' and 'bb' stay separate.",
  },
  {
    title: 'Container With Most Water',
    statement:
      'You are given an integer array height of length n. There are n vertical lines such that the two endpoints of the i-th line are (i, 0) and (i, height[i]). Find two lines that together with the x-axis form a container holding the most water. Return the maximum amount of water.\n\nExample: height = [1,8,6,2,5,4,8,3,7] -> 49.\nConstraints: 2 <= n <= 10^5.',
    solution:
      'class Solution:\n    def maxArea(self, height: list[int]) -> int:\n        lo, hi = 0, len(height) - 1\n        best = 0\n        while lo < hi:\n            best = max(best, (hi - lo) * min(height[lo], height[hi]))\n            if height[lo] < height[hi]:\n                lo += 1\n            else:\n                hi -= 1\n        return best',
    buggy:
      'class Solution:\n    def maxArea(self, height: list[int]) -> int:\n        lo, hi = 0, len(height) - 1\n        best = 0\n        while lo < hi:\n            best = max(best, (hi - lo) * min(height[lo], height[hi]))\n            if height[lo] > height[hi]:\n                lo += 1\n            else:\n                hi -= 1\n        return best',
    casesTotal: 10,
    failNote: 'expected 49, got 40 (pointer moved on the taller side, skipping the optimum)',
    groundTruth:
      'Returns max over pairs of (hi - lo) * min(height[lo], height[hi]); the two-pointer scan must always advance the shorter side.',
  },
]

// ---------------------------------------------------------------------------
// search/browsecomp-plus
// ---------------------------------------------------------------------------

export interface SearchSnippet {
  title: string
  url: string
  snippet: string
}

export interface SearchRound {
  query: string
  results: SearchSnippet[]
}

export interface SearchItem {
  question: string
  rounds: SearchRound[]
  thoughts: string[]
  answer: string
  wrong: string
  /** Substring of `wrong` marking the incorrect claim, for logprob shading. */
  wrongClaim: string
}

export const SEARCH_ITEMS: readonly SearchItem[] = [
  {
    question:
      'The architect who designed the Sydney Opera House later won the Pritzker Prize. In what year did he win it, and what nationality was he?',
    thoughts: [
      'Two facts to pin down: who designed the Sydney Opera House, then the year of his Pritzker. Starting with the building.',
      'Utzon confirmed as the architect; now the Pritzker year, which I believe is early 2000s.',
      'Cross-checking the year against the official Pritzker laureate list to avoid a biography paraphrase error.',
    ],
    rounds: [
      {
        query: 'Sydney Opera House architect',
        results: [
          {
            title: 'Sydney Opera House — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Sydney_Opera_House',
            snippet:
              'The Sydney Opera House was designed by Danish architect Jørn Utzon, who won an international design competition in 1957.',
          },
          {
            title: 'The story of Jørn Utzon | Sydney Opera House',
            url: 'https://www.sydneyoperahouse.com/our-story/jorn-utzon',
            snippet:
              'Jørn Utzon (1918–2008) was a relatively unknown 38-year-old Dane when his radical design was selected from 233 entries.',
          },
          {
            title: 'Utzon and the Opera House saga',
            url: 'https://www.architectureau.com/articles/utzon-saga',
            snippet:
              'Utzon left Australia in 1966 before the building was complete, never returning to see it finished.',
          },
        ],
      },
      {
        query: 'Jørn Utzon Pritzker Prize year',
        results: [
          {
            title: 'Jørn Utzon | The Pritzker Architecture Prize',
            url: 'https://www.pritzkerprize.com/laureates/2003',
            snippet:
              'Jørn Utzon of Denmark was awarded the Pritzker Architecture Prize in 2003, cited for the Sydney Opera House among other works.',
          },
          {
            title: 'Pritzker Architecture Prize — list of laureates',
            url: 'https://en.wikipedia.org/wiki/Pritzker_Architecture_Prize',
            snippet:
              '2002 Glenn Murcutt (Australia) · 2003 Jørn Utzon (Denmark) · 2004 Zaha Hadid (UK/Iraq).',
          },
        ],
      },
      {
        query: 'Pritzker Prize 2003 laureate official announcement',
        results: [
          {
            title: 'Announcement: 2003 Pritzker Prize goes to Jørn Utzon',
            url: 'https://www.pritzkerprize.com/announcement-utzon-2003',
            snippet:
              'The Hyatt Foundation announced today that Jørn Utzon, the Danish architect of the Sydney Opera House, is the 2003 Laureate.',
          },
          {
            title: 'Utzon wins architecture’s top honour',
            url: 'https://www.theguardian.com/world/2003/apr/07/architecture',
            snippet:
              'The 84-year-old Dane received the prize 30 years after the opera house opened.',
          },
        ],
      },
    ],
    answer:
      'Jørn Utzon, the Danish architect of the Sydney Opera House, won the Pritzker Architecture Prize in 2003. Both the official Pritzker laureate page and the laureate list confirm the year, and all sources agree he was Danish.',
    wrong:
      'Jørn Utzon, the architect of the Sydney Opera House, won the Pritzker Architecture Prize in 1998, and he was Norwegian.',
    wrongClaim: 'in 1998, and he was Norwegian',
  },
  {
    question:
      'Which element was discovered first: helium or argon, and how many years separate the two discoveries?',
    thoughts: [
      'Need discovery years for both elements; helium has the famous solar-spectrum story, argon came from Rayleigh and Ramsay.',
      'Helium 1868 (solar spectral line) is well attested; confirming argon at 1894.',
      'The subtraction is 26 years; double-checking that helium counts from the 1868 spectral identification rather than the 1895 terrestrial isolation.',
    ],
    rounds: [
      {
        query: 'helium discovery year 1868 solar spectrum',
        results: [
          {
            title: 'Helium — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Helium',
            snippet:
              'Helium was first detected as an unknown yellow spectral line in sunlight during the solar eclipse of 18 August 1868 by Jules Janssen and Norman Lockyer.',
          },
          {
            title: 'The discovery of helium',
            url: 'https://www.rsc.org/periodic-table/element/2/helium',
            snippet:
              'Its terrestrial presence was confirmed in 1895 when William Ramsay isolated it from cleveite.',
          },
        ],
      },
      {
        query: 'argon discovery year Rayleigh Ramsay',
        results: [
          {
            title: 'Argon — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Argon',
            snippet:
              'Argon was first isolated from air in 1894 by Lord Rayleigh and Sir William Ramsay, for which they received Nobel Prizes in 1904.',
          },
          {
            title: 'The discovery of argon (Royal Society)',
            url: 'https://royalsocietypublishing.org/doi/argon-discovery',
            snippet: 'The 1894 announcement of a new atmospheric constituent caused a sensation.',
          },
          {
            title: 'Ramsay and the noble gases',
            url: 'https://www.sciencehistory.org/education/ramsay-noble-gases',
            snippet:
              'Following argon (1894), Ramsay went on to isolate helium (1895), neon, krypton and xenon (1898).',
          },
        ],
      },
    ],
    answer:
      'Helium was discovered first — identified spectroscopically in sunlight in 1868 by Janssen and Lockyer — while argon was isolated in 1894 by Rayleigh and Ramsay. That places the discoveries 26 years apart.',
    wrong:
      'Argon was discovered first, in 1894, with helium following in 1895 when Ramsay isolated it from cleveite — a gap of just 1 year.',
    wrongClaim: 'Argon was discovered first',
  },
  {
    question:
      'The first woman to win a Nobel Prize won it jointly with her husband. In which year, in which category, and with whom did she share it besides her husband?',
    thoughts: [
      'This is Marie Curie; the joint prize with Pierre was Physics. Need the year and the third laureate.',
      '1903 Physics, shared with Henri Becquerel — verifying the split on the official Nobel page.',
    ],
    rounds: [
      {
        query: 'first woman Nobel Prize year',
        results: [
          {
            title: 'Nobel Prize awarded women — NobelPrize.org',
            url: 'https://www.nobelprize.org/prizes/lists/nobel-prize-awarded-women/',
            snippet:
              'Marie Curie was the first woman to be awarded a Nobel Prize, in Physics in 1903, and remains the only woman honoured twice.',
          },
          {
            title: 'Marie Curie — Facts',
            url: 'https://www.nobelprize.org/prizes/physics/1903/marie-curie/facts/',
            snippet:
              'The Nobel Prize in Physics 1903 was divided, one half to Henri Becquerel, the other half jointly to Pierre and Marie Curie.',
          },
          {
            title: 'Marie Curie — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Marie_Curie',
            snippet:
              'In 1911 she won a second Nobel, in Chemistry, for the discovery of radium and polonium.',
          },
        ],
      },
      {
        query: 'Nobel Prize Physics 1903 laureates Becquerel Curie',
        results: [
          {
            title: 'The Nobel Prize in Physics 1903',
            url: 'https://www.nobelprize.org/prizes/physics/1903/summary/',
            snippet:
              'Antoine Henri Becquerel "for his discovery of spontaneous radioactivity"; Pierre Curie and Marie Curie, née Sklodowska, "for their joint researches on the radiation phenomena discovered by Professor Henri Becquerel".',
          },
        ],
      },
    ],
    answer:
      'Marie Curie became the first female Nobel laureate in 1903, in Physics. The prize was split: one half to Henri Becquerel for discovering spontaneous radioactivity, the other half jointly to Marie and Pierre Curie for their radiation research.',
    wrong:
      'Marie Curie became the first female Nobel laureate in 1911, in Chemistry, sharing the prize with Henri Becquerel and her husband Pierre.',
    wrongClaim: 'in 1911, in Chemistry',
  },
  {
    question:
      'Which is taller when measured from base to summit: Mauna Kea or Mount Everest, and by roughly how much, using commonly cited figures?',
    thoughts: [
      'Everest wins on elevation above sea level, but Mauna Kea measured from its underwater base is taller overall. Need both figures.',
      'Commonly cited: Mauna Kea ~10,210 m base-to-summit vs Everest 8,849 m; the base-to-summit figure for Everest is much smaller, but the usual comparison uses its sea-level elevation.',
    ],
    rounds: [
      {
        query: 'Mauna Kea height base to summit total',
        results: [
          {
            title: 'Mauna Kea — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Mauna_Kea',
            snippet:
              'Measured from its base on the ocean floor, Mauna Kea is about 10,210 m (33,500 ft) tall — the tallest mountain on Earth — though only 4,207 m of it is above sea level.',
          },
          {
            title: 'Is Mauna Kea taller than Everest? — USGS',
            url: 'https://www.usgs.gov/faqs/mauna-kea-taller-everest',
            snippet:
              'Mauna Kea is the tallest mountain from base to peak; Mount Everest has the highest altitude.',
          },
        ],
      },
      {
        query: 'Mount Everest elevation 8849',
        results: [
          {
            title: 'Mount Everest — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Mount_Everest',
            snippet:
              "Everest's elevation of 8,848.86 m (29,031.7 ft) was jointly announced by China and Nepal in 2020.",
          },
          {
            title: 'How tall is Mount Everest, really?',
            url: 'https://www.nationalgeographic.com/everest-height',
            snippet: 'The 2020 survey settled on 8,848.86 metres above sea level.',
          },
        ],
      },
    ],
    answer:
      'Measured base-to-summit, Mauna Kea is taller: about 10,210 m from its ocean-floor base, versus Everest’s 8,849 m above sea level. Using those commonly cited figures, Mauna Kea is roughly 1,360 m "taller", even though Everest remains the highest point on Earth.',
    wrong:
      'Mount Everest is taller on both counts: its 8,849 m from base to summit exceeds Mauna Kea’s total height of about 6,000 m, by roughly 2,800 m.',
    wrongClaim: 'Mount Everest is taller on both counts',
  },
  {
    question:
      'What was the first video ever uploaded to YouTube, who uploaded it, and in what month and year?',
    thoughts: [
      'Well-known trivia: "Me at the zoo" by co-founder Jawed Karim. Confirming the date, April 2005.',
      'Verifying with two independent sources since anniversary articles sometimes shift the date.',
    ],
    rounds: [
      {
        query: 'first video uploaded to YouTube',
        results: [
          {
            title: 'Me at the zoo — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Me_at_the_zoo',
            snippet:
              '"Me at the zoo" is the first video uploaded to YouTube, on April 23, 2005, by co-founder Jawed Karim.',
          },
          {
            title: "YouTube's first video turns 18",
            url: 'https://www.theverge.com/youtube-me-at-the-zoo-anniversary',
            snippet: 'The 19-second clip shows Karim at the San Diego Zoo elephant enclosure.',
          },
          {
            title: 'Jawed Karim — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Jawed_Karim',
            snippet:
              'Karim uploaded the first YouTube video after co-founding the site with Chad Hurley and Steve Chen.',
          },
        ],
      },
      {
        query: '"Me at the zoo" upload date April 2005',
        results: [
          {
            title: 'Me at the zoo — YouTube',
            url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
            snippet: 'Uploaded Apr 23, 2005. The first video on YouTube.',
          },
        ],
      },
    ],
    answer:
      'The first YouTube video was "Me at the zoo", a 19-second clip filmed at the San Diego Zoo, uploaded by co-founder Jawed Karim in April 2005 (April 23, 2005).',
    wrong:
      'The first YouTube video was "Me at the zoo", uploaded by co-founder Chad Hurley in February 2005, the month the site was founded.',
    wrongClaim: 'Chad Hurley in February 2005',
  },
  {
    question:
      'Which novel won the first Hugo Award for Best Novel, and what magazine had originally serialized it?',
    thoughts: [
      'The first Hugo ceremony was 1953. Best Novel that year — I recall "The Demolished Man" by Alfred Bester.',
      'Now the serialization venue: Galaxy Science Fiction, verifying both facts.',
    ],
    rounds: [
      {
        query: 'first Hugo Award Best Novel 1953',
        results: [
          {
            title: 'Hugo Award for Best Novel — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Hugo_Award_for_Best_Novel',
            snippet:
              'The first Hugo for Best Novel was awarded in 1953 to The Demolished Man by Alfred Bester at the 11th Worldcon in Philadelphia.',
          },
          {
            title: '1953 Hugo Awards',
            url: 'http://www.thehugoawards.org/hugo-history/1953-hugo-awards/',
            snippet: 'Best Novel: The Demolished Man by Alfred Bester.',
          },
        ],
      },
      {
        query: 'The Demolished Man serialized Galaxy magazine',
        results: [
          {
            title: 'The Demolished Man — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/The_Demolished_Man',
            snippet:
              'The novel was serialized in three parts in Galaxy Science Fiction beginning January 1952, before book publication by Shasta in 1953.',
          },
          {
            title: 'Galaxy Science Fiction January 1952 contents',
            url: 'https://archive.org/details/galaxy-1952-01',
            snippet: 'Part one of The Demolished Man by Alfred Bester leads the issue.',
          },
        ],
      },
    ],
    answer:
      'The first Hugo Award for Best Novel (1953) went to Alfred Bester’s The Demolished Man, which had been serialized in Galaxy Science Fiction starting in January 1952 before its 1953 book publication.',
    wrong:
      'The first Hugo for Best Novel went to Isaac Asimov’s Foundation, originally serialized in Astounding Science Fiction.',
    wrongClaim: 'Isaac Asimov’s Foundation',
  },
  {
    question:
      'The deepest point in the ocean was first reached by a crewed vessel in 1960. Name the vessel, its two crew members, and the approximate depth reached.',
    thoughts: [
      'Challenger Deep, bathyscaphe Trieste, 1960. Crew: Jacques Piccard and Don Walsh. Depth ~10,900 m.',
      'Verifying the depth figure — sources quote 10,911 m or ~35,800 ft for the 1960 dive.',
    ],
    rounds: [
      {
        query: 'first crewed descent Challenger Deep 1960',
        results: [
          {
            title: 'Trieste (bathyscaphe) — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Trieste_(bathyscaphe)',
            snippet:
              'On 23 January 1960, Trieste, crewed by Jacques Piccard and Don Walsh, reached the bottom of the Challenger Deep at about 10,911 m (35,797 ft).',
          },
          {
            title: '60 years since the deepest dive',
            url: 'https://www.bbc.com/future/trieste-deepest-dive',
            snippet: 'Piccard and Walsh spent 20 minutes on the bottom of the Mariana Trench.',
          },
          {
            title: 'Don Walsh obituary',
            url: 'https://www.nytimes.com/don-walsh-obituary',
            snippet: 'Walsh, then a Navy lieutenant, co-piloted the record-setting 1960 dive.',
          },
        ],
      },
      {
        query: 'Trieste 1960 depth 10911 meters Challenger Deep',
        results: [
          {
            title: 'The dive of the Trieste — NOAA',
            url: 'https://oceanexplorer.noaa.gov/trieste-dive',
            snippet:
              'Instruments recorded 37,798 ft, later corrected to approximately 35,814 ft (10,916 m).',
          },
        ],
      },
    ],
    answer:
      'The bathyscaphe Trieste made the first crewed descent to the Challenger Deep on 23 January 1960, crewed by Jacques Piccard and US Navy lieutenant Don Walsh, reaching a depth of roughly 10,911 m (about 35,800 ft).',
    wrong:
      'The submersible Alvin made the first crewed descent in 1960, piloted by Jacques Cousteau and Don Walsh, to about 8,900 m.',
    wrongClaim: 'The submersible Alvin',
  },
  {
    question:
      'Which programming language was named after a comedy group rather than a snake, and in what year was its first public release?',
    thoughts: [
      'Python — Guido van Rossum named it after Monty Python. First public release: 0.9.0 in February 1991 on alt.sources.',
      'Confirming the 1991 date and the Monty Python origin from primary-ish sources.',
    ],
    rounds: [
      {
        query: 'Python language named after Monty Python release year',
        results: [
          {
            title: 'History of Python — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/History_of_Python',
            snippet:
              'Van Rossum named the language after the BBC show Monty Python’s Flying Circus. Python 0.9.0 was released to alt.sources in February 1991.',
          },
          {
            title: 'General Python FAQ',
            url: 'https://docs.python.org/3/faq/general.html#why-is-it-called-python',
            snippet:
              'When he began implementing Python, Guido van Rossum was reading the published scripts from Monty Python’s Flying Circus. No association with reptiles.',
          },
        ],
      },
      {
        query: 'Python 0.9.0 alt.sources February 1991',
        results: [
          {
            title: 'Python 0.9.1 archive posting',
            url: 'https://www.python.org/download/releases/early/',
            snippet:
              'The earliest surviving release archives date to the February 1991 alt.sources posting of 0.9.0.',
          },
        ],
      },
    ],
    answer:
      'Python is named after Monty Python’s Flying Circus, not the snake — Guido van Rossum was reading the show’s scripts while building it. Its first public release, version 0.9.0, was posted to alt.sources in February 1991.',
    wrong:
      'Python is named after Monty Python and was first publicly released in 1989, when Guido van Rossum published version 1.0 over Christmas.',
    wrongClaim: 'released in 1989',
  },
  {
    question:
      'What is the only country that borders both Germany and Spain, and approximately how long is its border with each?',
    thoughts: [
      'France is the only country bordering both. Border lengths: France–Germany ~450 km, France–Spain ~620-650 km along the Pyrenees.',
      'Figures differ slightly between sources; citing CIA World Factbook style numbers.',
    ],
    rounds: [
      {
        query: 'country borders both Germany and Spain',
        results: [
          {
            title: 'Geography of France — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Geography_of_France',
            snippet:
              'Metropolitan France borders Belgium, Luxembourg, Germany, Switzerland, Italy, Monaco, Spain and Andorra.',
          },
          {
            title: 'Borders of Germany — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Borders_of_Germany',
            snippet:
              'Germany borders nine countries; France lies to the southwest with a ~450 km frontier.',
          },
        ],
      },
      {
        query: 'France Germany border length km France Spain border length',
        results: [
          {
            title: 'France–Germany border — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/France%E2%80%93Germany_border',
            snippet:
              'The border is about 450 km (280 mi) long, following the Rhine for much of its length.',
          },
          {
            title: 'France–Spain border — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/France%E2%80%93Spain_border',
            snippet:
              'The border runs 623 km (387 mi) along the Pyrenees from the Bay of Biscay to the Mediterranean.',
          },
          {
            title: 'CIA World Factbook: France',
            url: 'https://www.cia.gov/the-world-factbook/countries/france/',
            snippet: 'Land boundaries include Germany 450 km, Spain 646 km, Andorra 55 km.',
          },
        ],
      },
    ],
    answer:
      'France is the only country bordering both Germany and Spain. Its border with Germany runs about 450 km, largely along the Rhine, while its Pyrenean border with Spain is roughly 620–650 km (Wikipedia cites 623 km; the CIA Factbook 646 km).',
    wrong:
      'Switzerland is the only country bordering both Germany and Spain, with roughly 350 km against each.',
    wrongClaim: 'Switzerland is the only country',
  },
  {
    question:
      'The fastest land animal and the fastest bird in a dive are often confused. Give both animals and their commonly cited top speeds.',
    thoughts: [
      'Cheetah for land (~100-120 km/h), peregrine falcon in a stoop (~320-390 km/h). Getting the standard cited figures.',
      'The falcon number varies; National Geographic and Guinness cite ~389 km/h from the 2005 instrumented dive.',
    ],
    rounds: [
      {
        query: 'fastest land animal cheetah top speed km/h',
        results: [
          {
            title: 'Cheetah — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Cheetah',
            snippet:
              'The cheetah is the fastest land animal, capable of 93–104 km/h in short bursts, with some measured runs to ~112 km/h.',
          },
          {
            title: 'How fast can a cheetah run? — Smithsonian',
            url: 'https://www.si.edu/cheetah-speed',
            snippet: 'Sarah the cheetah covered 100 m in 5.95 s, about 98 km/h sustained.',
          },
        ],
      },
      {
        query: 'peregrine falcon dive speed record 389',
        results: [
          {
            title: 'Peregrine falcon — Wikipedia',
            url: 'https://en.wikipedia.org/wiki/Peregrine_falcon',
            snippet:
              'The peregrine is the fastest member of the animal kingdom, reaching over 320 km/h in its hunting stoop; one instrumented dive recorded 389 km/h.',
          },
          {
            title: 'Fastest bird in a dive — Guinness World Records',
            url: 'https://www.guinnessworldrecords.com/fastest-bird-dive',
            snippet: 'A peregrine falcon named Frightful was clocked at 389.46 km/h in a dive.',
          },
        ],
      },
    ],
    answer:
      'The fastest land animal is the cheetah, commonly cited at 100–120 km/h in short bursts (measured runs around 98–112 km/h). The fastest bird — and animal overall — in a dive is the peregrine falcon, whose hunting stoop exceeds 320 km/h, with an instrumented record of about 389 km/h.',
    wrong:
      'The fastest land animal is the pronghorn at about 150 km/h, while the golden eagle holds the diving record at around 240 km/h.',
    wrongClaim: 'the pronghorn at about 150 km/h',
  },
]

export const SEARCH_FILLER_THOUGHTS: readonly string[] = [
  'The snippets agree with each other, so one more corroborating query is enough before synthesizing.',
  'One source is a primary record and one is an encyclopedia; when they agree I will treat the fact as settled.',
  'The question has two parts; answering only after both are independently confirmed.',
]

// ---------------------------------------------------------------------------
// Huge terminal trace content
// ---------------------------------------------------------------------------

export const HUGE_TASK =
  'Fleet-wide log audit: for each of the 24 web hosts, pull the last portion of the February application logs day by day, flag ERROR spikes and slow-query warnings, and produce a per-host summary. Work host by host; do not parallelize (the bastion rate-limits sessions).'

const HUGE_PATHS = [
  '/api/v2/traces',
  '/api/v2/traces/search',
  '/api/v2/components',
  '/api/v2/rollouts',
  '/api/v2/health',
  '/api/v2/evolution',
]

export function hugeLogLine(rng: Rng, day: number): string {
  const ts = `2026-02-${pad2(day)} ${pad2(rng.int(0, 23))}:${pad2(rng.int(0, 59))}:${pad2(rng.int(0, 59))}.${String(rng.int(0, 999)).padStart(3, '0')}`
  const req = rng.int(0, 0xffffffff).toString(16).padStart(8, '0')
  const kind = rng.next()
  if (kind < 0.06) {
    return `${ts} ERROR [req-${req}] upstream timeout to search-svc after 5000ms retry=${rng.int(0, 2)} route=${rng.pick(HUGE_PATHS)}`
  }
  if (kind < 0.16) {
    return `${ts} WARN  [pool-${rng.int(1, 8)}] slow query on traces_idx: ${rng.int(260, 4100)}ms (threshold 250ms) rows=${rng.int(1, 50000)}`
  }
  const status = rng.bernoulli(0.97) ? 200 : rng.pick([404, 422, 500])
  return `${ts} INFO  [req-${req}] GET ${rng.pick(HUGE_PATHS)}/${rng.int(1000, 99999)} ${status} ${rng.int(2, 480)}ms bytes=${rng.int(180, 262144)}`
}
