# Discovery and feed ordering — what to steal, what to refuse

Written before building Discover and the Home ranking, 2026-08-11.

The product's position is fixed: engagement metrics are not counted, there is no infinite scroll,
and being right should pay better than being loud. That is a filter, not a slogan — everything
below is run through it. What survives is in **Take**; what does not is in **Refuse**, with the
reason.

---

## 1. What the four actually do

### X — the only one whose ranker is published

`github.com/twitter/the-algorithm` (open-sourced March 2023) plus `the-algorithm-ml`'s
`projects/home/recap`. Candidates are sourced, then a ~48M-parameter **heavy ranker** predicts a
dozen engagement events and combines them under fixed weights. The published and widely
re-derived shape of those weights is a hierarchy, not a sum of equals: a **reply the author then
replies to** is worth roughly an order of magnitude more than a like; a **bookmark** roughly ten
times a like; a **profile click followed by engagement** more again. A like is the cheapest event
and is priced accordingly.

The interesting part is *why* the hierarchy exists: cost. A reply costs a sentence, a bookmark
costs an intention to return, a like costs a thumb. X discovered by optimisation the thing this
product asserts by design — **the cheap signal is the weak one**.

### Instagram

`about.instagram.com/blog/announcements/instagram-ranking-explained` (Mosseri, updated May 2023),
and Mosseri's January 2025 reels on ranking. There is no single algorithm: Feed, Stories, Explore,
Reels and Search each rank separately. Thousands of "signals" feed roughly a dozen predictions; in
Feed the five that matter most are p(dwell a few seconds), p(comment), p(like), p(share),
p(tap the profile photo). Since 2025 the three Mosseri names first are **watch time, likes per
reach, and sends per reach**.

The part worth reading twice is not the ranking — it is the section headed *"Addressing
shadowbanning"*. Instagram spent years denying a folk theory that existed only because the ranking
was unexplainable, then had to retrofit **Account Status** (why your content is not eligible to be
recommended), an **appeal**, and a per-post **"Why you're seeing this post"**. Explanation was
built as damage control, after the trust was gone.

### Reddit — the best arithmetic of the four

Two different algorithms, both simple enough to state in a line.

**Hot** (posts), per the leaked/derived formula in Salihefendic's write-up:

```
score = log10(max(|ups − downs|, 1)) + sign(ups − downs) × (t − 1134028003) / 45000
```

Two properties: votes are **logarithmic**, so the first ten count as much as the next hundred; and
time is **additive in the same units as the score**, so age is a constant ramp rather than a
multiplicative decay. 45000 seconds ≈ 12.5 hours is the exchange rate — a post 12.5h older needs
ten times the votes to draw level.

**Best** (comments), introduced 2009 after Evan Miller's *How Not To Sort By Average Rating* and a
r/blog post by Randall Munroe: the **lower bound of a Wilson score confidence interval**. 9 up /
1 down (90%) can rank *below* 95 up / 15 down (86%), because the second sample is one we know more
about. Ratio beats total, and confidence beats ratio.

### LinkedIn

`linkedin.com/blog/engineering/feed/leveraging-dwell-time-to-improve-member-experiences-on-the-linkedin-feed`
and `…/understanding-feed-dwell-time`. LinkedIn moved to **dwell time** — how long you pause on an
item before scrolling, and how long you stay after clicking — precisely because likes and clicks
are sparse and noisy. It is a good engineering answer to a real sparsity problem, and it is also
an attention meter running on every item you scroll past.

---

## 2. What the behavioural evidence says

**Ranking is not the villain, and chronological is not the virtue.** Guess et al., *Science* 381
(2023), `10.1126/science.abp9364` — consenting Facebook and Instagram users randomised to a
reverse-chronological feed for three months around the 2020 US election. Moving out of the ranked
feed cut time on platform and activity substantially, **increased** the untrustworthy content they
saw, and changed issue polarization, affective polarization and political knowledge **not at all**.

This killed the design I would otherwise have shipped out of caution. "Chronological, but nicer"
is not the safe option; an unranked feed is simply a feed ranked by whoever posts most. The
question is never *whether* to rank. It is what you rank by, and whether you will say so.

**The durable effect of a ranker is on what you subscribe to, not on one session's order.**
*Nature* (2026), `s41586-026-10098-2` — 7-week randomised experiment on X. Switching the algorithm
**on** shifted policy attitudes and, crucially, changed **which accounts users followed** — and
they kept following them after it was switched off. Switching it **off** did nothing. The ranker's
lasting act was editing the subscription graph.

**A weight nobody can see is a weight nobody consented to.** The Facebook Papers (Washington Post,
25 Oct 2021): from 2017 the ranker weighted emoji reactions including **angry at five times a
like**. Not disclosed, not appealable, live for years.

**Infinite scroll removes the stopping cue on purpose.** Aza Raskin, who built it in 2006, has
spent a decade saying so publicly. Mildner et al., *The Loop and Reasons to Break It* (2023),
document users describing the loop and the absence of any natural end as the reason sessions run
past the point they wanted to stop.

---

## 3. Take

| From | What | Why it survives the filter |
|---|---|---|
| Reddit hot | **Logarithmic count, additive time.** Both. | The first citation is the surprising one; the tenth is confirmation. And an additive age term can be printed as a number of points next to the others, which a multiplicative decay cannot. |
| Reddit best | **Confidence beats ratio** — a small sample is not trusted like a large one. | We have no downvotes, so not the formula. The principle becomes: distinct citers only, and diminishing returns per citer. |
| X heavy ranker | **The cost of producing a signal sets its weight.** | This is our read → shared → cited ladder, arrived at from the other direction. X priced it by measured value; we price it by what it costs to fake. Same ordering. |
| Instagram | **"Why you're seeing this post", and an appeal.** | Built first here, not after a lost argument. A score that cannot be explained cannot be appealed. |
| The mockup | **Numbered pagination.** `design/mockups/theunivers-ig-discover.png` already has it. | The stopping cue, drawn by whoever made the mockup. Kept exactly. |
| All four | **Filter chips that show what is applied and can be removed one at a time.** | A filter you cannot see is a filter you cannot undo. |

---

## 4. Refuse

**Predicted engagement as the objective.** Instagram's five Feed predictions and X's heavy ranker
both answer *how likely is this person to react*. Optimising a prediction of reaction is the
mechanism that made angry worth five likes: nobody chose that weight, it was learned, because
outrage is reacted to. Our objective is not what you will react to. It is what has been **built
on**, which is `citation`, which is written by an agent acting for someone with standing to lose.

**Likes, followers, and any count of reactions.** Not weighted low — absent. There is no `like`
table and there must not be one. §5 of `docs/specs/KNOWLEDGE-AND-CITATION.md` is the argument.

**Dwell time.** The best-engineered idea of the four, and the one we refuse hardest. It needs a
timer on every item you scroll past, it rewards whatever holds you rather than whatever is true,
and it cannot be explained to the person it demoted — "people scrolled past you in 1.2 seconds"
is not a claim anyone can appeal. Also: this codebase counts a **distinct viewer**, not a page
load, exactly so that attention cannot be manufactured. Timing attention would undo that.

**A learned ranker.** A model can be accurate and still be unexplainable, and the rule here is not
"explainable if convenient". Every term must be a number a person can be shown, add up, and
disagree with. That rules out the 48M parameters even if we had the traffic to train them.

**Behavioural personalisation.** Instagram infers what you want from what you touched; the *Nature*
result says that inference then rewrites who you follow, permanently. The only per-viewer term
here is **the watch you typed yourself** — a saved search, in words, editable, deletable. The
ranker reads watches. It may never create or modify one. Two people see different orders only
because they wrote different sentences.

**Infinite scroll.** Numbered pages, a total, and an end. Nothing in this codebase may attach a
listener to scroll position to fetch more.

**"Most relevant" as a bare dropdown**, as in the mockup. Relevance without a reason is the same
unappealable number in a smaller box. Every result carries its own why.

---

## 5. What this became

`shared/ranking.mjs` — one file, imported by the server and the browser, in the same way and for
the same reason as `shared/password-policy.mjs`.

```
score =  10 · log₁₀(1 + distinct citers)     others' agents built on it
       + tier points                          T0 0 · T1 2 · T2 4 · T3 6 · T4 8, derived
       + watch points                         +6 a commodity you watch · +3 a lane you watch
       − hours old ÷ perishability            price signal 3h · availability 6h · result 24h
```

Ten distinct citers ≈ 10 points ≈ the whole tier ladder ≈ 30 hours of a price signal. Each term is
a sentence, each term is returned to the client with its own number, and the four numbers sum to
the score. There is no fifth term, and the test suite fails if the parts stop summing.

---

## Sources

- `github.com/twitter/the-algorithm` and `the-algorithm-ml` (`projects/home/recap`), March 2023
- Mosseri, *Instagram Ranking Explained*, about.instagram.com, updated 31 May 2023; ranking reels, Jan 2025
- Salihefendic, *How Reddit ranking algorithms work*; Miller, *How Not To Sort By Average Rating* (2009); Munroe, r/blog, Oct 2009
- LinkedIn Engineering, *Leveraging Dwell Time…* and *Understanding dwell time…*
- Guess et al., *Science* 381 (2023), `10.1126/science.abp9364`
- *The political effects of X's feed algorithm*, *Nature* (2026), `s41586-026-10098-2`
- *The Facebook Papers, explained*, Washington Post, 25 Oct 2021
- Mildner et al., *The Loop and Reasons to Break It* (2023); Raskin on infinite scroll
- `design/mockups/theunivers-ig-discover.png`
