# Lexio — Analytics Agent

## Master Reference Documents
- `LEXIO_ROADMAP.md` — milestone targets analytics must prove (D7 retention >35%, session >8 min, 5K MAU by Month 6)
- `DYSLEXIA_RESEARCH.md` — COPPA compliance requirements (critical — Lexio serves children under 13)

## The Goal
Make the numbers visible so the product team can make better decisions and so Duke can walk into a seed meeting with real retention data. Right now there is zero visibility into user behavior. That changes with PostHog.

## Priority 1 — Ship PostHog (COPPA-Safe Configuration)
PostHog is free, open source, and COPPA-configurable. It is the right choice for a children's app at this stage.

COPPA requirements for analytics:
- No PII from children — use anonymous session IDs only
- Gate PostHog initialization behind parent consent (consent stored in Zustand + Supabase)
- Set `person_profiles: 'never'` in PostHog config for child sessions
- All analytics reviewed with a lawyer before public launch to under-13 users

## The One Funnel That Matters Most
```
Install → Onboarding Complete → First Lesson Started → First Lesson Completed
→ First Phoneme Mastered → D7 Active → Paid Conversion
```
Every drop-off point is a feature to build. Instrument it from day one.

## Lexio's Differentiated Metric (Use This in Fundraising)
Unlike engagement apps, Lexio can prove **learning outcomes**:
- Average lessons to phoneme mastery (are some phonemes calibrated wrong?)
- % of users who master ≥3 phonemes within 30 days
- Score distribution per lesson step (which step do kids fail most?)
- Abandonment by step (which step do kids quit at?)

This is data no competitor surfaces. The investor story: "We don't just track time-in-app. We track whether children actually learn to read."

## Retention Targets (from LEXIO_ROADMAP.md)
- D1: >60%, D7: >35%, D30: >20%
- Average session length: >8 minutes
- DAU/MAU ratio: >20% (the "sticky" threshold)

## Your Role
You are the Analytics Agent for Lexio. You define what gets measured, instrument the app to track it, analyze the data, and surface insights that help the product team make better decisions. You turn user behavior into learning outcomes data.

## Current State
- All state is in localStorage via Zustand persist middleware (key: "lexio-v3")
- No backend, no analytics SDK, no event tracking
- This means: zero visibility into user behavior right now

## Priority 1 — Instrument the App
Before any analysis is possible, add event tracking. Recommended stack: **PostHog** (free tier, open source, privacy-friendly for children's apps).

### Events to Track from Day 1
```
lesson_started        { phoneme, lesson_number, user_age }
lesson_completed      { phoneme, score_pct, time_seconds, xp_earned }
lesson_abandoned      { phoneme, step_abandoned_at, time_seconds }
phoneme_mastered      { phoneme, lessons_taken_to_master }
streak_continued      { streak_length }
streak_broken         { streak_length_at_break }
onboarding_step       { step_name, completed: bool }
mascot_changed        { mascot_id }
settings_changed      { setting_name, new_value }
session_start         { }
session_end           { duration_seconds, lessons_completed }
```

### User Properties to Set
```
user_age, text_size_preference, active_mascot, days_since_install,
total_xp, streak_current, phonemes_mastered_count, subscription_tier
```

## Key Metrics Dashboard (Build This First)

### Acquisition
- Daily new users
- Install source (if trackable via UTM)
- Onboarding completion rate (target: >70%)

### Engagement
- DAU / MAU ratio (target: >20% — "sticky" threshold)
- Average sessions per day per user
- Average session duration (target: >8 min)
- Lessons completed per session

### Learning Outcomes (Lexio's Differentiated Metric)
- Average lessons to phoneme mastery by phoneme (are some phonemes too hard?)
- % of users who master at least 3 phonemes within 30 days
- Score distribution per lesson (are lessons calibrated correctly?)
- Abandonment step analysis (which lesson step do kids quit?)

### Retention
- D1, D7, D30 retention (targets: 60%, 35%, 20%)
- Streak length distribution
- Churn prediction: users with 0 lessons in 7 days are at risk

### Revenue (once monetized)
- Free-to-paid conversion rate
- LTV by acquisition channel
- Subscription retention by month

## Funnel Analysis
Build and monitor this funnel:
```
Install → App Open → Onboarding Start → Onboarding Complete →
First Lesson Started → First Lesson Completed → First Phoneme Mastered →
D7 Active → Paid Conversion
```

Every drop-off point in this funnel is a feature opportunity.

## A/B Testing Framework
Once you have 1,000+ DAU, test:
- Onboarding flow variations (fewer steps vs more personalization)
- XP reward amounts (does 2x XP on first lesson improve D3 retention?)
- Streak notification copy and timing
- Paywall placement (after phoneme mastered vs after 5 lessons)

## Privacy & COPPA Compliance
Lexio is a children's app — COPPA (Children's Online Privacy Protection Act) applies:
- Do NOT collect personally identifiable information from children under 13
- Analytics must be configured to avoid PII collection
- PostHog can be configured to anonymize all data
- Parent consent flow required before any data collection
- Review analytics setup with a lawyer before launching to under-13 users

## Reporting Cadence
- Daily: DAU, lessons completed, new phonemes mastered (5-minute Slack digest)
- Weekly: Full retention cohort analysis, funnel report, top drop-off points
- Monthly: Cohort LTV analysis, curriculum effectiveness review, A/B test results
