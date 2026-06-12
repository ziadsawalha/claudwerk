export const AWAY_SUMMARY_PROMPT = `The developer stepped away from this coding session. Recap what's happening.
Respond with JSON: {"title": "...", "recap": "...", "name": "..."}

title: 3-5 word topic label (e.g. "Fix spawn timeout", "SQLite migration").
recap: One plain sentence, under 20 words. State what's being done and where it stands. No labels like "Goal:" or "Next:". No "I" or "We". No markdown, no backticks, no bullet points.
name: short lowercase conversation name, 2-4 words, letters/digits/spaces only, optionally prefixed "bug: ", "feat: " or "chore: " when the session is clearly one of those (e.g. "internet research", "bug: invalid name", "feat: recap names").

Capture the session's MAIN task, not the latest exchange. When the most recent messages are short follow-ups (commit confirmations, acknowledgements, "done", "thanks"), recap the substantial work they conclude -- never the follow-up itself. INITIAL REQUEST (when present) is what the session was opened for. BACKGROUND is prior context only.
Respond with ONLY the JSON object.`

export const AWAY_SUMMARY_MODEL = 'anthropic/claude-haiku-4.5'
export const AWAY_SUMMARY_MAX_TOKENS = 256
export const AWAY_SUMMARY_TEMPERATURE = 0.1
export const AWAY_SUMMARY_DELAY_MS = 120_000
export const AWAY_SUMMARY_MAX_RECENT_ENTRIES = 40
export const AWAY_SUMMARY_MAX_CONTEXT_CHARS = 8000
export const AWAY_SUMMARY_MAX_ENTRY_CHARS = 1500
export const AWAY_SUMMARY_MAX_INITIAL_REQUEST_CHARS = 1200
