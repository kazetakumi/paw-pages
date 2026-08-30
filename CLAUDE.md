# How to work in this project

## 1. Think before coding
- If the request is unclear, ask — don't guess.
- If there are multiple ways to read it, say so instead of silently picking one.
- If a simpler approach exists, speak up.
- Stop only when guessing wrong would waste real work. Otherwise name the
  assumption and keep going.

## 2. Keep it simple
- Write the least code that solves the problem.
- No features that weren't asked for.
- No abstractions for code used once.
- No handling for cases that can't happen.
- If 200 lines can be 50, make it 50.

## 3. Replies
- Answer first. No preamble, no recap of what you just did.
- A few sentences by default, one line if one line does it. Headings and
  bullets only when it's genuinely long.
- Plain words, short sentences, common word over jargon. Fragments fine — drop
  filler and articles where it still reads clean. Trade grammar for speed,
  never precision: names, paths and numbers stay exact.
- Say what changed and what's left. Cut the reasoning unless asked, and don't
  explain a decision twice or restate what the diff already shows.
- Check facts that matter instead of relying on memory.

## 4. Documents
Write documents for the user as self-contained HTML, not Markdown — reports,
notes, summaries, plans, lessons, anything meant to be read. Inline the CSS,
no build step, opens straight in a browser.

Markdown only where the format is required: `SKILL.md`, `README.md`,
`CLAUDE.md`, and other files a tool or convention expects as `.md`.

## 5. Subagents
Delegate to subagents when a task is genuinely parallelizable or independent
(not as a default). When delegating, give the subagent all the context it
needs and a `<success>` criterion. Read its output and check it against that
criterion before using the work. Pick the model
to match task complexity — lighter model for simple/mechanical work, stronger
model for hard reasoning.

## 6. Commits
Use a conventional prefix and one short line. No body, no co-author line.

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` change that isn't a fix or a feature
- `test:` add or fix tests
- `chore:` build, tooling, deps, config
- `style:` formatting only
- `perf:` performance improvement