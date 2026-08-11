# Knowledge and citation — specification

**Status:** draft · §3 resolved · build order in §9
**Covers:** people publishing to their own profile, agents reading it to build something, and the
standing a creator earns from being used.

---

## 1. The scenario

People post to their profile — video, reel, photo, carousel, text. Then:

> *"I want to build Jarvis. Check what people have written and give me clean steps."*
>
> *"Someone here explains how they set buy and sell points and read the graphs. Watch it and build
> me a document on the strategy."*

The agent gathers what is relevant, produces a document, and **cites every piece it used**. Each
creator's cited work earns a score that rises as more people's agents rely on it.

---

## 2. What this actually is

**A citation economy where standing is derived from use.**

That sentence is the whole thing, and it is the same invariant as the trade side wearing different
clothes:

| | Trade | Knowledge |
|---|---|---|
| Evidence | anchors — a licence, an on-site visit | published work |
| Signal | completed deals, passed inspections | **citations by other people's agents** |
| Standing | trust tier T0–T4 | citation standing |
| Rule | **derived, never granted** | **derived, never granted** |

A like is a reaction. A citation is a claim that something was *useful enough to build on*, made by
an agent acting for someone with their own standing to lose. That is a far harder signal to fake
and a far more honest one to publish.

**It is also the reason to post here rather than on Instagram.** There, expertise earns attention
that evaporates. Here it earns a record of having been used — which compounds, and which a buyer's
agent can check before hiring you. That is the same argument the study makes for verified conduct,
applied to knowledge instead of goods.

---

## 3. RESOLVED — sharing is the consent event

The earlier draft of this section asked whether agents should *ingest* content or merely
*reference* it, and called it a blocking decision. **The question dissolves once the flow is
user-initiated**, which is how it should have been read the first time:

> *"When I find something useful on Instagram I download it and share it to Telegram. Why can I not
> find something useful in the app and share it to my agent?"*

That is not a platform harvesting a corpus. It is one person choosing one item, the way they
already save a post — and choosing is what makes it lawful, consensual and meaningful all at once:

- **Lawful.** No crawling, no bulk fetch, no terms-of-service problem. A person exercising their
  own access to something already shown to them.
- **Consensual.** Publishing to a profile on this platform carries permission to be *shared into
  someone's project*, in the same way a post carries permission to be saved.
- **Meaningful as a signal.** Nobody files rubbish into their own research. A share is a far
  stronger statement than a like, precisely because it costs attention rather than a tap.

**Neither option A nor B. The corpus is what people deliberately share, one item at a time.**

External links are still referenced by URL rather than fetched — a person may paste something they
have themselves, but the platform does not go and get it.

## 4. The objects

| Object | Holds |
|---|---|
| `project` | a subject you are working on. Created as "Project 1", renamed to whatever it turns out to be — "Jarvis", "building an app". Renameable because you rarely know what a line of research is until you are some way into it. |
| `note` | a file inside a project — *"how to build Jarvis"*. Holds the analysis. **Movable between projects**, because today's Jarvis search and tomorrow's app search sort themselves out only in hindsight. |
| `source` | what was shared: the post, its author, and the passage used. One row per share, so a note's provenance is a list rather than a paragraph. |
| `citation` | what an AGENT actually used while producing a note. **Not the same as a share.** |
| `view` | distinct viewers, split into `person` and `agent`. |

### Read, shared, cited — three different claims

They are a ladder of increasing commitment and must never be collapsed into one number, because
only the top of it means anything:

| | What it says | Who does it |
|---|---|---|
| **viewed** | somebody looked | a person, or an agent scanning |
| **shared** | somebody filed it into their own project | a person, deliberately |
| **cited** | somebody's agent **built on it** | the agent, while producing |

A share is you collecting; a citation is your agent using. Plenty is shared and never used — and
counting a share as a citation would make the number mean "bookmarked" while claiming it means
"built on". That is the overclaiming this codebase refuses everywhere else.

Views are split because an agent may machine-read a hundred posts to use one; merged, a post
scanned by one agent would look as popular as one read by fifty people. A view is also a DISTINCT
VIEWER, not a page load — a counter that rises when you scroll past twice is a vanity metric, and
the argument of this whole product is against numbers that can be manufactured.

The hierarchy is deliberately shallow: **project → note → sources**. Anything deeper is filing
rather than thinking, and a research tool that demands filing gets abandoned.

**A citation records what was taken, not merely that something was.** "Used `work_3f` at 04:12 for
the entry-signal rule" is checkable by the creator. "Cited `work_3f`" is not, and an uncheckable
citation is a number, not evidence.

A person may still mark a work as not-for-sharing — glad to have a tutorial used, unwilling to have
a family photograph filed into a stranger's research. That is a per-item setting on the work, not a
global policy.

---

## 5. The citation score, and how it will be attacked

Score derived from citations, exactly as tier is derived from anchors. Never stored as a settable
field.

**It will be farmed.** Any number that confers standing is farmed, and the design must assume it
from the first line rather than react later:

- **Self-citation earns nothing.** An agent citing its own principal's work adds zero.
- **A citation carries the weight of the citer.** A citation from a T0 account with no record
  counts for almost nothing; one from a T3 with completed deals counts. This makes a Sybil farm
  cost what standing costs, which is the entire point of deriving tier from anchors.
- **One citer, diminishing returns.** The tenth citation of the same work by the same person adds
  far less than the first. Enthusiasm is not corroboration.
- **A citation must sit in a real document, and the document must have been read.** A doc nobody
  opened is not evidence anything was useful.
- **Every score is explainable.** The same rule as tier: a score that cannot be explained cannot be
  appealed, and an unappealable score is a badge.

**What is deliberately not counted:** views, likes, followers. Importing engagement metrics imports
engagement incentives, and this is a place where being *right* should pay better than being loud.

---

## 6. Misrepresentation

An agent summarising a nine-minute video will sometimes be wrong, and the person who gets blamed is
the creator whose name is on the citation.

**A cited creator can challenge a citation.** Not the document — the citation. The claim is narrow
and checkable: *"this doc says I recommended X at 04:12; I did not."* Upheld challenges reduce the
citing agent's weight, not the creator's.

This is the dispute flow from the trade side, applied to a claim about what someone said rather
than about what was delivered. Same shape: a narrow, evidenced complaint, resolved against a stated
standard rather than a vibe.

---

## 7. What this reuses

Almost everything, which is the argument for building it here rather than as a separate product:

- **the derived-standing rule** — tier already works this way
- **the receipt chain** — a doc's citations are an append-only record of what was used
- **the dispute flow** — challenges over misrepresentation
- **the workspace** — a brief in progress is a draft; a doc is its output
- **ADR-0001** — an agent building a doc reads other people's content, which is **untrusted input**.
  A video whose transcript says *"ignore your previous instructions"* must be data, never
  instruction. This is the prompt-injection surface, and it is bigger here than anywhere else in
  the product because the whole feature is reading strangers' words.

---

## 8. Open questions

1. **Does a citation pay anything, or only count?** A score that never converts is a leaderboard. A
   score that pays is a payment, and payments are the perimeter in §3 of the order spec.
2. **Who reads the video?** Transcription and vision are model calls, and this feature is
   model-heavy in a way the rest of the product is not. The cost model matters before the feature
   does.
3. **Does the doc belong to the person who asked, or is it publishable?** If publishable, it becomes
   citable itself, and citation chains form. That is either the best part of this or the beginning
   of a spam economy.
4. **What is the standard of proof for a misrepresentation challenge?** Same unanswered question as
   trade disputes, and answering it once should serve both.

## 9. Build order

1. **`work`** — publishing to a profile, with an explicit per-item licence. Nothing else is
   possible without a corpus, and the licence must exist from the first row rather than be
   backfilled onto content people published under different terms.
2. **`brief` → `doc`** — with citations, on text works only. Text first because it is cheap,
   testable, and proves the shape before any transcription bill.
3. **citation standing** — derived, explainable, with the weighting in §5 from the start.
4. **challenges**.
5. **video and image**, once §8.2 has an answer.
