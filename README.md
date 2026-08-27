# MediaDrum Automate

A standalone newsroom automation for [mediadrumworld.com](https://mediadrumworld.com).

Every morning it scrapes the web for stories worth writing about, picks five,
works out the angle each one deserves, and emails the authors a brief. When an
author picks one and answers a handful of questions, their answers become the
article — drafted, SEO-briefed, and saved straight into WordPress under their
byline for review.

The point is the last part. **Nothing here publishes AI copy about a news story.**
The pipeline finds the story and asks the questions; the author's own take is
the substance, which is the only thing that earns organic search traffic.

---

## The flow

```
06:00 UTC   cron ──▶ scrape ~35 feeds  (RSS · Google News · Reddit)
                       │
                       ├─ drop anything older than 72h
                       ├─ score on recency, beat fit, headline hooks
                       ├─ skip sensitive topics (crime, bereavement, live cases)
                       ├─ drop what's already published or already pitched
                       └─ cap per beat / per publisher / per topic
                       │
                     ~28 candidates ──▶ fetch full article text
                       │
                     story meeting (Claude) ──▶ 5 stories, each with:
                       │                           · a faithful factual summary
                       │                           · an angle the coverage missed
                       │                           · 5–6 questions for the author
                       │                           · headline options + SEO brief
                       │
                     email each active author a magic link
                                     │
   author clicks ────▶ /brief/<token>          pick a story
                  ────▶ .../write/<id>          answer the questions
                                     │
                             draft (Claude)     author's answers = the spine
                                     │
                          WordPress REST ──▶ saved as a DRAFT, their byline
                                     │
                          email back the edit link + editor notes
```

---

## Stack

| Piece | What it does |
| --- | --- |
| **Next.js 16** (App Router) | Cron endpoint, author pages, admin dashboard |
| **Supabase** (Postgres) | Sources, authors, digests, submissions, dedupe ledger, logs |
| **Claude Opus 5** | Story selection, angles, questions, and drafting |
| **Resend** | The daily brief and the "draft ready" email |
| **WordPress REST** | Publishing, authenticated with an Application Password |
| **Vercel Cron** | Fires the daily run |

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

```bash
cp .env.example .env.local
```

Fill it in. Generate the secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Variable | Notes |
| --- | --- |
| `APP_URL` | Public URL of *this* app. Magic links are built from it. |
| `TOKEN_SECRET` | Signs author magic links. 32+ random chars. |
| `CRON_SECRET` | Vercel Cron sends it as a bearer token. |
| `ADMIN_PASSWORD` | Gate for `/admin`. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Server-side only — this key bypasses RLS. |
| `ANTHROPIC_API_KEY` | From console.anthropic.com. |
| `WP_URL` / `WP_USERNAME` / `WP_APP_PASSWORD` | WP Admin → Users → Profile → Application Passwords. Spaces are stripped for you. |
| `WP_DEFAULT_STATUS` | `draft` (recommended), `pending`, or `publish`. |
| `RESEND_API_KEY` / `EMAIL_FROM` | `EMAIL_FROM` must be on a domain verified in Resend. |

### 3. Database

```bash
npm run db:migrate
```

This creates the schema and seeds 35 sources plus the nine WordPress authors.

Local runs connect over the Supabase **session pooler**. `db.<ref>.supabase.co`
is IPv6-only on current projects, so if your network has no IPv6 route, set
`SUPABASE_DB_HOST` to the pooler host from Supabase → Project Settings →
Database (for this project: `aws-0-eu-west-2.pooler.supabase.com`).

### 4. Check the wiring

```bash
npm run dev
```

```bash
curl -s localhost:3000/api/health -H "Authorization: Bearer $CRON_SECRET"
```

Every check should read `ok: true`.

### 5. Deploy

Push to GitHub, import the repo in Vercel, and add every variable from
`.env.local` to the Vercel project (set `APP_URL` to the production domain).
`vercel.json` registers the 06:00 UTC cron automatically.

> Vercel's Hobby plan allows one cron per day and caps functions at 60s, which
> the discovery run will exceed. This needs the **Pro** plan for the 300s limit
> that `vercel.json` asks for.

---

## Test mode

`EMAIL_TEST_MODE` is **on by default**. While it is on, every email — the daily
brief and the "draft ready" notice — is redirected to `EMAIL_TEST_RECIPIENT`
instead of the real author, and carries a banner naming who it was addressed to.
No author receives anything. If test mode is on and no recipient is set,
nothing is sent at all; that is the safe direction to fail in.

Turning it off has to be deliberate — `EMAIL_TEST_MODE=false` — and should wait
until a verified sending domain is in place.

> **Resend needs a verified domain before this can email anyone else.** Until
> `mediadrumworld.com` is verified at [resend.com/domains](https://resend.com/domains),
> Resend refuses `newsroom@mediadrumworld.com` as a sender and only delivers to
> the account owner's own address. Verifying the domain fixes both at once, and
> is the one step standing between test mode and real delivery.

---

## What it costs

Measured on real runs, not estimated:

| Stage | Model | Tokens | Cost |
| --- | --- | --- | --- |
| Daily curation | `claude-sonnet-5`, effort `medium` | ~17k in / ~9k out | **$0.12** |
| One article | `claude-opus-5`, effort `high` | ~4k in / ~5k out | **$0.15** |

So roughly **$3.60/month** for the daily brief, plus about **$0.15 per article**
actually commissioned. Curation on Opus at `high` cost $0.44 a run — 3.6× more —
for no better a shortlist, which is why the two stages use different models.

Levers, cheapest first: `CURATION_EFFORT=low`, `CURATION_MODEL=claude-haiku-4-5`,
`DEEP_READ_COUNT` (fewer candidates read), `CURATION_TEXT_BUDGET` (less text per
candidate). Leave `WRITING_MODEL` alone — the article is the product, it only
runs when someone commissions it, and it is the cheap half of the bill anyway.

---

## Day to day

### `/admin`

Sign in with `ADMIN_PASSWORD`. From there:

- **Run discovery now** — fire the daily run by hand. **Force re-run** discards
  today's digest and redoes it.
- **Submissions** — every piece an author has claimed, with a **Retry** button
  for failures. The author's answers are saved, so retries never lose work.
- **Authors** — toggle who receives the brief. Only Ritesh is active on a fresh
  install, so the first live runs email one person.
- **Sources** — per-source status and item counts, and an on/off switch.
- **Log** — the last 25 pipeline events.

### Tuning the sources without spending tokens

```bash
curl -s "localhost:3000/api/admin/preview?limit=30" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Runs everything up to the model call — scrape, score, dedupe — and returns the
funnel, per-source yield, and what *would* have been shortlisted, with the
scoring reasons for each. Nothing is written and no tokens are spent. This is
the right way to judge a new feed or a change to the ranking weights.

### Adding a source

```sql
insert into sources (name, kind, url, beat, weight) values
  ('My feed', 'rss', 'https://example.com/feed', 'lifestyle', 1.2);
```

`kind` is `rss`, `google_news`, or `reddit` — it only controls how links are
unwrapped. `weight` multiplies the final score.

---

## How quality is defended

The premise of the whole system is that AI-written news does not rank. So:

- **The author's answers are the spine.** `AUTHOR_VOICE_CONTRACT` in
  `src/lib/ai/house-style.ts` instructs that any paragraph which could have been
  written without reading their answers gets cut, that their phrasings are
  quoted rather than paraphrased into neutral prose, and that their position is
  not smoothed out into false balance.
- **The questions are built to be unanswerable by a model** — personal
  experience, what the coverage got wrong, a number they would stake. The
  curation prompt explicitly bans "what are the implications of X".
- **Facts are fenced.** Every claim must trace to the source article or the
  author. No invented quotes, statistics, dates, or study findings. Gaps go in
  `editor_notes` rather than getting filled in.
- **A banned-phrase linter** runs over every draft (`lintArticle`) and flags
  house-style violations, missing source attribution, thin word counts, and
  over-long metadata into the editor notes.
- **The form shows answer depth** and tells the author when there is too little
  to build a real piece from.
- **Drafts, not posts.** Everything lands unpublished.

---

## Safety rails

- Fresh crime, bereavement, live court proceedings, safeguarding and
  humanitarian crises are filtered out before the model ever sees them
  (`SENSITIVE_PATTERNS`). The filter is deliberately blunt: the cost of a false
  positive is one missed story, the cost of a false negative is a tasteless
  opinion piece about a real person's worst day.
- Authors reach their brief through HMAC-signed, single-purpose, 7-day tokens.
  No accounts, no passwords.
- Every table has RLS enabled with no permissive policies, so the publishable
  and anon keys can read nothing. All access is server-side via the service role.
- A unique partial index guarantees one live submission per story, so two
  authors cannot both write the same piece.

---

## Project layout

```
src/lib/
  env.ts              lazy, validated environment access
  supabase.ts         service-role client + run_logs helper
  tokens.ts           HMAC magic links
  admin-auth.ts       /admin password → signed cookie
  wordpress.ts        REST client, site profile, tags, Rank Math meta
  sources/
    feed.ts           RSS/Atom/RDF parsing, per-host throttling, 429 retry
    extract.ts        JSON-LD → article container → densest <p> extraction
    normalize.ts      URL canonicalisation, title fingerprints, similarity
    rank.ts           scoring, sensitive filter, dedupe, diversity caps
  ai/
    house-style.ts    the frozen, cacheable style + author-voice contract
    schemas.ts        Zod schemas for both structured-output calls
    curate.ts         the daily story meeting
    write.ts          drafting + the post-generation linter
  email/              Resend client and the two HTML templates
  pipeline/
    discover.ts       the whole daily job
    publish.ts        answers → draft → WordPress → notify

src/app/
  api/cron/discover   the daily entrypoint (bearer-authenticated)
  api/submissions     create a submission; generation runs via after()
  api/admin/*         run, retry, toggle, preview, login
  brief/[token]/      the author's brief, questionnaire, and progress page
  admin/              the dashboard
```

---

## Known limitations

- **Reddit rate-limits anonymous RSS.** Two of the three Reddit sources
  intermittently return 429 despite per-host throttling and a backed-off retry.
  They degrade gracefully — the run continues and `/admin` shows the status.
- **Rank Math meta over REST is currently discarded.** Verified against the live
  site: `rank_math_description` and `rank_math_focus_keyword` are not registered
  for REST, so WordPress accepts the request with a 200 and silently drops the
  values. The client reads the meta back to detect this, and falls back to
  putting the meta description in the author's editor notes for manual pasting.

  To make it write properly, add this to the theme's `functions.php` or a small
  site plugin — after that the fallback note stops appearing on its own:

  ```php
  add_action( 'init', function () {
      foreach ( [ 'rank_math_description', 'rank_math_focus_keyword', 'rank_math_title' ] as $key ) {
          register_post_meta( 'post', $key, [
              'type'          => 'string',
              'single'        => true,
              'show_in_rest'  => true,
              'auth_callback' => fn() => current_user_can( 'edit_posts' ),
          ] );
      }
  } );
  ```
- **No featured image is set.** The draft carries a `featured_image_brief`
  telling the picture desk what to source; wiring it to an image API or the WP
  media library would be the natural next step.
- **Google News links are unwrapped via an undocumented endpoint.** Their RSS
  links point at a JS interstitial, not a 302, so the real publisher URL is
  recovered through Google's own `batchexecute` RPC (`resolveGoogleNews` in
  `src/lib/sources/extract.ts`). This lifted full-text extraction from 11/28 to
  15/20 candidates and keeps `news.google.com` out of published citations — but
  it is an internal endpoint and will break eventually. It fails soft: the
  Google link is kept and the story is briefed from its headline, as before.
  The tell is the `Fetched full text for N/M` line in the log dropping back
  toward a third.
