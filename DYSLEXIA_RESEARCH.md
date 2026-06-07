# Dyslexia Research — Lexio Product Intelligence

*Compiled: May 29, 2026. Use this to make every product decision evidence-backed.*

---

## What Is Dyslexia

Dyslexia is a neurological learning difference affecting approximately **1 in 5 people** (20% of the population). It is the most common learning disability, accounting for 80–90% of all learning disabilities. It is not related to intelligence — dyslexic individuals include many highly successful people in every field.

Dyslexia primarily affects:
- Phonological processing (connecting sounds to letters)
- Decoding (sounding out unfamiliar words)
- Spelling
- Reading fluency (speed and accuracy)
- Working memory for written language

It does NOT affect: general intelligence, creativity, spatial reasoning, or verbal comprehension.

---

## The Science of Reading (What Actually Works)

The National Reading Panel identified **5 pillars of effective reading instruction**, all backed by decades of research:

1. **Phonemic Awareness** — Hearing and manipulating individual sounds (phonemes) in spoken words. Example: "What sounds do you hear in CAT? /k/ /æ/ /t/". This is the #1 predictor of reading success.

2. **Phonics** — Connecting letters (graphemes) to sounds (phonemes) systematically. This is Lexio's core. Systematic, explicit phonics instruction is the gold standard per the NRP.

3. **Fluency** — Reading with speed, accuracy, and expression. Develops after phonics is solid.

4. **Vocabulary** — Understanding word meanings. Context and explicit instruction both matter.

5. **Comprehension** — Understanding what is read. The ultimate goal.

**Lexio is strongest in pillars 1–2. The roadmap should build toward 3–5 over time.**

---

## Multisensory Learning: The Core Mechanism

The most evidence-backed intervention for dyslexia is **structured literacy with multisensory instruction** — also called the Orton-Gillingham approach. It engages multiple sensory pathways simultaneously:

- **Visual** — seeing the letter/word
- **Auditory** — hearing the sound spoken aloud
- **Kinesthetic-tactile** — tracing, writing, building with tiles

A 2026 longitudinal study (Frontiers in Education) confirmed that structured multisensory phonics instruction in small-group settings produces significant improvements in phonological awareness, oral language, and early literacy in at-risk children.

**Lexio's lesson structure (Hear → See → Trace → Build) is exactly this model.** Do not remove or shortcut any step — the multisensory sequence is the therapeutic mechanism, not just an engagement feature.

### Key rule: All three modalities must fire in every lesson.
- Visual only = flashcards. Not enough.
- Auditory only = audiobooks. Not enough.
- All three together = structured literacy. This is what works.

---

## Phonological Awareness: The Foundation

Phonological awareness — the ability to hear and manipulate sounds in spoken language — is the #1 predictor of reading ability. It develops before reading and underpins all phonics learning.

Skills in developmental order:
1. **Rhyme recognition** — "Do CAT and BAT rhyme?" (ages 3–4)
2. **Syllable counting** — "How many beats in BUTTERFLY?" (ages 3–4)
3. **Onset-rime** — "Say CAT without the /k/" = "AT" (ages 4–5)
4. **Phoneme isolation** — "What's the first sound in SHIP?" = /sh/ (ages 5–6)
5. **Phoneme segmentation** — "Say each sound in FISH" = /f/ /ɪ/ /sh/ (ages 5–6)
6. **Phoneme manipulation** — "Change the /k/ in CAT to /b/" = BAT (ages 6–7)

**Implication for Lexio:** The "Hear It" lesson step (phonemic awareness) must precede the "See It" step (phonics). This order is not arbitrary — it mirrors the developmental sequence.

---

## Rhythm and Music: 2025 Breakthrough Finding

**Source:** Scientific Reports (Nature), 2025 — randomized controlled trial

A 30-week study of children with dyslexia found that rhythmic and musical training produced **significant improvements in phonological awareness and reading skills**. Music-based activities including beat perception, clapping to syllables, and rhythmic production enhance the neural pathways used for phonological processing.

**Why this matters for Lexio:**
- Add rhythm/clapping to phoneme segmentation exercises
- "Clap the syllables with me: SUN-SHINE → clap, clap"
- Beat visualization (bouncing dot or pulsing tile) during word audio playback
- This is a genuine, research-backed differentiator that no major competitor is implementing

---

## Font and Typography: What the Research Actually Says

**The surprising finding:** Font choice matters less than spacing.

| Intervention | Evidence Quality | Effect |
|---|---|---|
| Wider letter spacing | Strong | Consistently improves reading speed |
| Wider line spacing | Moderate | Reduces crowding errors |
| OpenDyslexic font | Weak/Mixed | Some studies show *reduced* speed vs. Arial |
| Lexend font | Moderate-Strong | Measurable fluency gains (Vanderbilt research) |
| Color overlays | Moderate | Reduces visual stress for some readers |

**What this means for Lexio:**

1. **Keep Lexend as the primary UI font** — it has the best evidence base.
2. **OpenDyslexic as an opt-in accessibility setting** — some users prefer it subjectively even if the research is mixed. Offer it, don't force it.
3. **Prioritize generous letter spacing** (`letter-spacing: 0.12em` minimum in lesson text). This has stronger research support than any specific font.
4. **Line height** should be 1.5–2x in lesson text (prevents crowding).
5. **Color background tints** — offer cream (#FFFDF5 — already the app's `C.bg`), light blue, light yellow, light green. The `bgTint` setting already exists in the store. Expand it.

---

## Color and Visual Design for Dyslexic Readers

- **Avoid pure white backgrounds** — high contrast white can cause visual stress (Meares-Irlen syndrome affects ~20% of dyslexic readers). Lexio's warm cream background (`#FFFDF5`) is already correct.
- **Avoid justified text** — uneven word spacing makes reading harder. Use left-aligned text only.
- **Avoid italics** — italic text is significantly harder for dyslexic readers.
- **Use clear, consistent visual hierarchy** — dyslexic readers rely heavily on visual structure to navigate text.
- **High contrast between text and background** — minimum 4.5:1 ratio (WCAG AA). Lexio's ink-on-cream palette is good; verify with a contrast checker.

---

## Early Screening: The Biggest Opportunity

**Key finding:** Dyslexia can be identified as early as age 3–4 — before a child is expected to read.

Early warning signs parents can observe:
- Difficulty rhyming (can't say what rhymes with CAT)
- Delayed speech or word-finding difficulty
- Trouble learning letter names and sounds
- Confusing similar sounds in words ("pasketti" for spaghetti)
- Family history of dyslexia (strongest single predictor — 5x risk)
- Avoiding books, storytelling, or listening to stories

**Critical statistic:** Children with both a family history of dyslexia AND early language difficulties are **5x more likely** to have significant reading problems by age 8–9 without early support.

**What existing apps do:** Most apps skip screening entirely. EarlyBird (validated at Boston Children's Hospital) does screening well but is standalone — not integrated into a learning experience.

**Lexio's opportunity:** Be the first app to integrate a warm, non-clinical early screening into the onboarding flow, then adapt the learning experience based on the result. This is a genuine moat and a press/fundraising story.

---

## Letter Reversal: The b/d Problem

Letter reversal (confusing b/d, p/q) is the most visible and common marker of dyslexia. It is caused by the brain's natural tendency to recognize objects regardless of orientation — a useful skill for everything except reading.

**Evidence-backed interventions:**
- **Tactile tracing** — tracing the letter with a finger while saying the sound builds kinesthetic memory that overrides visual confusion. Already in Lexio via `TraceLetter` component.
- **Memory anchors** — "A lowercase b looks like a bed (b-e-d). The stick comes first, then the bump to the right." Visual mnemonics with consistent imagery.
- **Color coding** — b always in one color, d always in another, consistently throughout the app.
- **Over-practice** — letter reversals require more repetitions than typical phonemes. b/d should get their own dedicated "Tricky Twins" mini-lesson.

---

## Working Memory: Design Implications

Dyslexic readers often have reduced working memory for written language. This affects:
- Holding letter sounds in mind while blending them
- Following multi-step instructions
- Keeping track of progress within a lesson

**Design rules for Lexio:**
- Instructions must be ≤ 1 sentence (or delivered via audio — the child can't read them anyway)
- One task at a time — never show the next step until the current one is complete
- Progress must be visually persistent (always show where the child is in the lesson)
- Never require the child to remember something from earlier in the lesson — always show it
- Celebrate every correct answer immediately — working memory is taxed, so positive feedback must be instant

---

## COPPA & Privacy

Lexio serves children under 13. COPPA (Children's Online Privacy Protection Act) requirements:

- **No PII from children** — do not collect name, photo, location, or any identifying data from the child
- **Parent creates the account** — child uses the app under the parent's profile
- **Parental consent** required before any data collection begins
- **Analytics must be anonymized** — PostHog can be configured for this
- **Data deletion** — parents must be able to request all data deleted
- **School deployments** need a Data Processing Agreement (DPA) — prepare a template before any school pitch

---

## Competitive Landscape (Dyslexia-Specific)

| App | Strength | Weakness | Lexio Advantage |
|---|---|---|---|
| Nessy | Strong phonics, dyslexia-focused | Dated UI, expensive | Modern design + gamification |
| Learning Ally | Audiobooks for dyslexic readers | Not a phonics teacher | Teaches decoding, not just accommodation |
| EarlyBird | Validated screening | Standalone, no curriculum | Screening + curriculum in one |
| Duolingo ABC | Free, polished | Surface-level phonics | Deep structured literacy |
| ABCmouse | Broad coverage | Cluttered, not dyslexia-focused | Focused, clean, evidence-based |
| Reading Eggs | School-proven | Feels dated | B2B channel + modern UX |

**Lexio's defensible position:** The only modern, gamified, structured literacy app that integrates early dyslexia screening, multisensory instruction (including rhythm), and parent-facing learning outcome data — built from the ground up around the Science of Reading.

---

## Key Research Sources

- National Reading Panel (2000) — 5 pillars of reading instruction (foundational)
- Frontiers in Education (2026) — multisensory phonics-based intervention, longitudinal
- Scientific Reports / Nature (2025) — rhythm training and dyslexia
- NIH / PubMed — inter-letter spacing and dyslexia readability
- Edutopia — "Do Dyslexia Fonts Actually Work?" (2024)
- Vanderbilt University — Lexend font readability research
- NAEP — US reading proficiency data
- International Dyslexia Association — structured literacy standards
