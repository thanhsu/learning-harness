# NotebookLM Workflow (manual, free)

learning-harness deliberately does **not** automate NotebookLM uploads —
NotebookLM has no public upload API, and browser automation would be brittle
and against its terms. Instead, every generated note is a clean, self-contained
Markdown file designed to be a good NotebookLM source.

## Steps

1. Open your vault (default `~/LearningVault`) — each lecture is one `.md` file
   containing the summary, key concepts, definitions, quiz, flashcards, and the
   raw transcript.
2. Go to <https://notebooklm.google.com> (free with a Google account).
3. Create a notebook per course (e.g. "Biology 101").
4. Click **Add source → Upload** and select the note file(s). Markdown uploads
   directly; if a file is ever rejected, copy-paste its content as a text
   source instead.
5. Use NotebookLM's chat, Audio Overview, and study-guide features on top of
   your own notes.

## Tips

- **One notebook per course, one source per lecture** keeps citations precise.
- The free tier caps sources per notebook — if a course is long, merge older
  notes into one "Semester so far" file:

  ```bash
  cat ~/LearningVault/2026-0*-bio*.md > ~/LearningVault/bio-101-semester.md
  ```

- The **Raw Transcript** appendix at the bottom of each note gives NotebookLM
  full context beyond the summary; keep it in.
- Notes are plain Markdown, so the same files also work in Obsidian, Logseq, or
  any other tool pointed at `~/LearningVault`.
