# Courseware corpus

Open textbooks that ground the copilot's explanations. Filing facts always come
from the filing; courseware supplies the concepts, methods, and vocabulary.

## Adding a textbook

```bash
pip install -r requirements-ingest.txt          # once
cp ~/Downloads/valuation-text.pdf courseware/sources/
```

Add an entry to `manifest.yaml`:

```yaml
  - id: valuation
    citation_label: VAL
    title: "Corporate Valuation"
    authors: [Author Name]
    license: CC BY-SA 4.0                # required -- see Licensing below
    license_url: https://creativecommons.org/licenses/by-sa/4.0/
    attribution: >-
      "Corporate Valuation" by Author Name, licensed CC BY-SA 4.0.
    url: https://example.org/the-book
    path: sources/valuation-text.pdf
    skip_pages: "1-12"                   # front matter
    printed_page_offset: auto
    default_lens: [valuation]
```

Then:

```bash
python scripts/ingest_courseware.py
```

Only the new source is extracted and embedded; existing books are skipped on
their content hash. Commit `courseware/index/` and deploy — nothing else
changes. Not the retriever, not the prompt, not the tool schema.

## Why lenses instead of one tool per book

A lens is an analytical posture, not a document. One book can carry several
(this textbook spans financial accounting, statement analysis, and managerial
accounting), and several books can share one. Tool-per-book breaks down exactly
where you want to grow:

- corpora overlap — a valuation text covers statement analysis too, so "which
  tool?" has no stable answer;
- the model would have to route *before* retrieving, from a one-line
  description, when embeddings can route on actual content;
- routing accuracy degrades as near-identical tool descriptions accumulate.

So retrieval searches everything and lets scores decide. `lens` exists as an
*optional* filter for when the model is genuinely confident.

The second job of a lens is the one that matters more: `guidance` in the
manifest is injected into the system prompt when that lens dominates the
retrieved passages. A valuation lens then changes *how* the copilot reasons —
name the driver, label assumptions, sanity-check the multiple — not just which
paragraphs it saw. That selection is data-driven, from retrieval scores, rather
than declared up front.

## Verifying retrieval before it reaches the prompt

```bash
python scripts/search_courseware.py "how is inventory valued under LIFO" -v
python scripts/search_courseware.py --suite
```

`--suite` includes negative cases ("what was Apple's revenue in fiscal 2023")
that *should* retrieve nothing. If those score above your floor, the floor is
too low and textbook material will leak into purely factual answers.

### Measured on the `bap` corpus (1222 chunks)

| | min | p10 | median | max |
|---|---|---|---|---|
| 17 concept questions | 0.368 | 0.451 | 0.607 | 0.725 |
| 8 company-fact / off-topic | 0.143 | — | 0.390 | 0.444 |

| floor | negatives leaked | positives dropped |
|---|---|---|
| 0.30 | 6 / 8 | 0 / 17 |
| 0.40 | 3 / 8 | 1 / 17 |
| **0.45** (default) | **0 / 8** | **1 / 17** |
| 0.55 | 0 / 8 | 5 / 17 |

Re-measure after adding a source; the floor is corpus-dependent.

**Known weak spot.** The one positive below the floor is *"how does the matching
principle work"* (0.368) — it retrieves the correct section, but that chunk sits
inside a broad "The major principles" section covering several principles at
once, so its embedding is diluted across all of them. Questions aimed at one
concept inside a long undifferentiated section are where this corpus is
weakest. If a new book has many such sections, lower `target_tokens`; the
agentic path fixes it differently, by letting the model re-query.

Encouragingly, questions phrased in *company* language rather than textbook
language bridge well — "their gross margin fell this year, what drives that"
(0.584), "is this revenue recognition policy aggressive" (0.545), and "what does
the allowance for doubtful accounts tell me about management judgment" (0.619)
all land on the right chapter.

## Tuning

`chunking` in the manifest, then:

```bash
python scripts/ingest_courseware.py --rechunk
```

Extraction (the slow part) is reused; only chunks whose text actually changed
are re-embedded. Three cache layers make this cheap:

| stage | cost | invalidated by |
|---|---|---|
| extract | ~9 min/book | PDF hash, `skip_pages` |
| chunk | seconds | extraction, `chunking`, lens rules |
| embed | ~$0.01/book | chunk text, model, dimensions |

## Index layout

Committed (the app reads these):

| file | purpose |
|---|---|
| `index/chunks.jsonl` | one chunk per line, with citation + lens metadata |
| `index/chunks.offsets.npy` | byte offsets, so a query reads only the k lines it hit |
| `index/vectors.f16.npy` | unit-normalized float16, cosine == dot product |
| `index/index.meta.json` | model/dims/lens registry the server validates against |
| `index/manifest.lock.json` | per-source hashes driving incremental rebuilds |
| `index/sources/*` | per-source shards — what makes rebuilds incremental |

Local only (gitignored): `sources/` (the PDFs) and `index/cache/`.

## Runtime configuration

| env var | default | effect |
|---|---|---|
| `COURSEWARE_ENABLED` | `1` | `0` disables retrieval entirely |
| `COURSEWARE_TOP_K` | `6` | passages per query |
| `COURSEWARE_MAX_PER_SECTION` | `2` | caps near-duplicate neighbours from one section |
| `COURSEWARE_MIN_SCORE` | `0.45` | similarity floor; keeps textbook text out of purely factual questions |
| `COURSEWARE_EMBED_MODEL` | from index | guard — must match what the index was built with |

A missing or unreadable index is not an error: `courseware.available()` returns
`False` and the copilot behaves exactly as it did before courseware existed.

## Scaling

At 512 dimensions in float16, one ~1000-page textbook is roughly 1 MB of
vectors and 3 MB of text. Ten books stay comfortably inside a git repo and a
Vercel bundle. Past roughly 50k chunks — or as soon as students upload their
own material — move the vectors to a hosted store (Upstash Vector or Supabase
pgvector, both HTTP, which matters on serverless). Only `server/courseware.py`
changes; the manifest, ingest pipeline, chunk schema, and lens model carry over
unchanged.

## Licensing

Every retrieved excerpt is a redistribution, so attribution is a real
obligation, not a formality. `license` is a required field — ingest refuses a
source without one — and `attribution` strings are surfaced through
`courseware.attributions()` for display in the UI. Check each source's terms
before ingesting: `NC` variants constrain commercial use, and `SA` variants
carry share-alike conditions.
