-- MediaDrum Automate :: seed data
-- Idempotent. Safe to re-run; existing rows are left untouched.

-- ---------------------------------------------------------------------------
-- Authors, mapped to their real WordPress user IDs on mediadrumworld.com.
--
-- NOTE: only Ritesh is `active` out of the box, so the first live runs email
-- exactly one person. Flip the others on from /admin (or with a single UPDATE)
-- once you are happy with the briefs.
-- ---------------------------------------------------------------------------
insert into authors (name, email, wp_user_id, beats, active, publish_status) values
  ('Ritesh Agarwal',  'ritesh@appycodes.com',            10, '{}', true,  'draft'),
  ('Amrita Carroll',  'editorial@mediadrumworld.com',     1, '{}', false, 'draft'),
  ('Oliver McAninch', 'olliemcaninch@gmail.com',          5, '{}', false, 'draft'),
  ('Lee Oliver',      'lee@outreachpro.co.uk',            7, '{}', false, 'draft'),
  ('Angela Dowden',   'angela@mediadrumworld.com',        9, '{}', false, 'draft'),
  ('Michael Carroll', 'michael.carroll79@gmail.com',     11, '{}', false, 'draft'),
  ('Mark McConville', 'mark@mediadrumworld.com',          3, '{}', false, 'draft'),
  ('Ben Williams',    'williamsben055@gmail.com',         6, '{}', false, 'draft'),
  ('Steve Rosberg',   'steverosberg@mediadrumworld.com',  8, '{}', false, 'draft')
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Sources. Weight nudges the pre-ranking: higher = trusted to surface the kind
-- of story this site actually runs. All are public RSS/Atom endpoints.
-- ---------------------------------------------------------------------------
insert into sources (name, kind, url, beat, weight) values
  -- General UK/world news
  ('BBC News',                'rss', 'https://feeds.bbci.co.uk/news/rss.xml',                           'world',       1.0),
  ('BBC World',               'rss', 'https://feeds.bbci.co.uk/news/world/rss.xml',                     'world',       1.0),
  ('Sky News',                'rss', 'https://feeds.skynews.com/feeds/rss/home.xml',                    'world',       0.9),
  ('The Guardian UK',         'rss', 'https://www.theguardian.com/uk/rss',                              'world',       1.0),
  ('Metro UK',                'rss', 'https://metro.co.uk/feed/',                                       'curiosity',   1.3),

  -- Lifestyle / human interest -- the bread and butter of this site
  ('Guardian Life and Style', 'rss', 'https://www.theguardian.com/lifeandstyle/rss',                    'lifestyle',   1.2),
  ('Independent Lifestyle',   'rss', 'https://www.independent.co.uk/life-style/rss',                    'lifestyle',   1.2),
  ('BBC Health',              'rss', 'https://feeds.bbci.co.uk/news/health/rss.xml',                    'lifestyle',   1.1),

  -- History
  ('BBC History Extra',       'rss', 'https://www.historyextra.com/feed/',                              'history',     1.3),
  ('Smithsonian Magazine',    'rss', 'https://www.smithsonianmag.com/rss/latest_articles/',             'history',     1.3),
  ('Live Science',            'rss', 'https://www.livescience.com/feeds/all',                           'history',     1.1),

  -- Environment / nature
  ('Guardian Environment',    'rss', 'https://www.theguardian.com/environment/rss',                     'nature',      1.1),
  ('BBC Science & Environment','rss','https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',   'nature',      1.1),

  -- Travel / places
  ('Atlas Obscura',           'rss', 'https://www.atlasobscura.com/feeds/latest',                       'travel',      1.4),
  ('Guardian Travel',         'rss', 'https://www.theguardian.com/travel/rss',                          'travel',      1.0),

  -- Technology
  ('The Verge',               'rss', 'https://www.theverge.com/rss/index.xml',                          'technology',  1.0),
  ('Ars Technica',            'rss', 'https://feeds.arstechnica.com/arstechnica/index',                 'technology',  1.0),
  ('BBC Technology',          'rss', 'https://feeds.bbci.co.uk/news/technology/rss.xml',                'technology',  1.1),

  -- Business / money
  ('BBC Business',            'rss', 'https://feeds.bbci.co.uk/news/business/rss.xml',                  'business',    1.0),
  ('Guardian Money',          'rss', 'https://www.theguardian.com/money/rss',                           'business',    1.1),

  -- Sport
  ('BBC Sport',               'rss', 'https://feeds.bbci.co.uk/sport/rss.xml',                          'sport-gaming',0.9),

  -- Food
  ('Guardian Food',           'rss', 'https://www.theguardian.com/food/rss',                            'food',        1.0),

  -- Offbeat aggregators
  ('Reddit /r/nottheonion',   'reddit', 'https://www.reddit.com/r/nottheonion/hot/.rss?limit=40',       'curiosity',   1.2),
  ('Reddit /r/UpliftingNews', 'reddit', 'https://www.reddit.com/r/UpliftingNews/hot/.rss?limit=40',     'curiosity',   1.1),
  ('Reddit /r/todayilearned', 'reddit', 'https://www.reddit.com/r/todayilearned/top/.rss?t=day&limit=40','history',    1.0),

  -- Google News standing queries, tuned to the beats this site converts on
  ('GN: human interest',      'google_news', 'https://news.google.com/rss/search?q=%22human+interest%22+OR+%22heartwarming%22+OR+%22incredible+story%22+when:2d&hl=en-GB&gl=GB&ceid=GB:en',        'lifestyle',  1.2),
  ('GN: transformation',      'google_news', 'https://news.google.com/rss/search?q=%22weight+loss%22+OR+%22transformation%22+OR+%22body+positivity%22+when:2d&hl=en-GB&gl=GB&ceid=GB:en',          'lifestyle',  1.2),
  ('GN: rare condition',      'google_news', 'https://news.google.com/rss/search?q=%22rare+condition%22+OR+%22rare+disease%22+OR+%22medical+mystery%22+when:3d&hl=en-GB&gl=GB&ceid=GB:en',         'lifestyle',  1.2),
  ('GN: abandoned places',    'google_news', 'https://news.google.com/rss/search?q=%22abandoned%22+(explorer+OR+photographer+OR+urbex+OR+ruins)+when:5d&hl=en-GB&gl=GB&ceid=GB:en',                'travel',     1.4),
  ('GN: archaeology finds',   'google_news', 'https://news.google.com/rss/search?q=archaeologists+discover+OR+%22unearthed%22+OR+%22shipwreck%22+when:3d&hl=en-GB&gl=GB&ceid=GB:en',               'history',    1.3),
  ('GN: wartime history',     'google_news', 'https://news.google.com/rss/search?q=%22World+War%22+(photographs+OR+letters+OR+veteran+OR+declassified)+when:5d&hl=en-GB&gl=GB&ceid=GB:en',         'history',    1.3),
  ('GN: wildlife',            'google_news', 'https://news.google.com/rss/search?q=wildlife+photographer+OR+%22rare+animal%22+OR+%22caught+on+camera%22+when:3d&hl=en-GB&gl=GB&ceid=GB:en',        'nature',     1.2),
  ('GN: cost of living UK',   'google_news', 'https://news.google.com/rss/search?q=%22cost+of+living%22+UK+when:2d&hl=en-GB&gl=GB&ceid=GB:en',                                                     'business',   1.1),
  ('GN: AI and jobs',         'google_news', 'https://news.google.com/rss/search?q=(AI+OR+%22artificial+intelligence%22)+(jobs+OR+workers+OR+backlash)+when:2d&hl=en-GB&gl=GB&ceid=GB:en',         'technology', 1.2),
  ('GN: viral debate',        'google_news', 'https://news.google.com/rss/search?q=%22sparks+debate%22+OR+%22divides+the+internet%22+OR+%22goes+viral%22+when:2d&hl=en-GB&gl=GB&ceid=GB:en',       'curiosity',  1.3)
on conflict (url) do nothing;
