-- MediaDrum Automate :: core schema
-- Every table lives in `public` but is locked down: the app talks to Postgres
-- exclusively through the service role from server-side code, so RLS is enabled
-- with no permissive policies (deny-by-default for the anon/publishable keys).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- sources :: where we look for news every morning
-- ---------------------------------------------------------------------------
create table if not exists sources (
  id              uuid primary key default gen_random_uuid(),
  name            text        not null,
  kind            text        not null default 'rss'
                              check (kind in ('rss', 'google_news', 'reddit')),
  url             text        not null unique,
  beat            text        not null,        -- maps loosely to a WP category slug
  weight          real        not null default 1.0,
  enabled         boolean     not null default true,
  last_fetched_at timestamptz,
  last_status     text,
  last_item_count integer     not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists sources_enabled_idx on sources (enabled);

-- ---------------------------------------------------------------------------
-- authors :: who receives the daily brief, and who they are in WordPress
-- ---------------------------------------------------------------------------
create table if not exists authors (
  id             uuid primary key default gen_random_uuid(),
  name           text        not null,
  email          text        not null unique,
  wp_user_id     integer     not null,
  beats          text[]      not null default '{}',  -- empty array = all beats
  active         boolean     not null default true,
  publish_status text        not null default 'draft'
                             check (publish_status in ('draft', 'pending', 'publish')),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- site_profile :: cached snapshot of what mediadrumworld.com actually publishes.
-- Refreshed at the start of every discovery run; feeds the curation prompt.
-- ---------------------------------------------------------------------------
create table if not exists site_profile (
  id            integer primary key default 1 check (id = 1),
  categories    jsonb       not null default '[]'::jsonb,  -- [{id,name,slug,count}]
  top_tags      jsonb       not null default '[]'::jsonb,  -- [{name,count}]
  recent_titles jsonb       not null default '[]'::jsonb,  -- ["headline", ...]
  keywords      text[]      not null default '{}',
  refreshed_at  timestamptz
);

insert into site_profile (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- seen_items :: dedupe ledger. Every candidate we have ever considered.
-- ---------------------------------------------------------------------------
create table if not exists seen_items (
  id            uuid primary key default gen_random_uuid(),
  url_hash      text        not null unique,
  canonical_url text        not null,
  title         text        not null,
  title_key     text        not null,          -- normalised token signature
  source_name   text,
  published_at  timestamptz,
  first_seen_at timestamptz not null default now()
);

create index if not exists seen_items_title_key_idx on seen_items (title_key);
create index if not exists seen_items_first_seen_idx on seen_items (first_seen_at desc);

-- ---------------------------------------------------------------------------
-- digests :: one per daily run
-- ---------------------------------------------------------------------------
create table if not exists digests (
  id                 uuid primary key default gen_random_uuid(),
  run_date           date        not null,
  status             text        not null default 'running'
                                 check (status in ('running', 'sent', 'failed', 'empty')),
  candidates_scanned integer     not null default 0,
  candidates_kept    integer     not null default 0,
  sources_ok         integer     not null default 0,
  sources_failed     integer     not null default 0,
  model              text,
  error              text,
  started_at         timestamptz not null default now(),
  sent_at            timestamptz
);

create unique index if not exists digests_run_date_idx on digests (run_date);
create index if not exists digests_started_idx on digests (started_at desc);

-- ---------------------------------------------------------------------------
-- digest_items :: the five shortlisted stories, each with its angle + questions
-- ---------------------------------------------------------------------------
create table if not exists digest_items (
  id                  uuid primary key default gen_random_uuid(),
  digest_id           uuid        not null references digests (id) on delete cascade,
  position            integer     not null,

  -- the original story, as scraped
  source_headline     text        not null,
  source_name         text        not null,
  source_url          text        not null,
  source_published_at timestamptz,
  image_url           text,
  factual_summary     text        not null,
  key_facts           jsonb       not null default '[]'::jsonb,
  source_excerpt      text,

  -- the editorial spin we propose
  angle_title         text        not null,
  angle_pitch         text        not null,
  why_it_fits         text        not null,
  headline_options    jsonb       not null default '[]'::jsonb,
  questions           jsonb       not null default '[]'::jsonb,

  -- SEO brief
  suggested_category  text,
  suggested_tags      jsonb       not null default '[]'::jsonb,
  seo                 jsonb       not null default '{}'::jsonb,

  created_at          timestamptz not null default now(),
  unique (digest_id, position)
);

create index if not exists digest_items_digest_idx on digest_items (digest_id);

-- ---------------------------------------------------------------------------
-- author_tokens :: signed magic links emailed to each author
-- ---------------------------------------------------------------------------
create table if not exists author_tokens (
  id              uuid primary key default gen_random_uuid(),
  digest_id       uuid        not null references digests (id) on delete cascade,
  author_id       uuid        not null references authors (id) on delete cascade,
  token_hash      text        not null unique,
  expires_at      timestamptz not null,
  first_opened_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (digest_id, author_id)
);

-- ---------------------------------------------------------------------------
-- submissions :: an author picked a story, answered the questions, we wrote it
-- ---------------------------------------------------------------------------
create table if not exists submissions (
  id              uuid primary key default gen_random_uuid(),
  digest_item_id  uuid        not null references digest_items (id) on delete cascade,
  author_id       uuid        not null references authors (id) on delete cascade,

  answers         jsonb       not null default '[]'::jsonb,  -- [{question, answer}]
  extra_notes     text,
  chosen_headline text,
  tone            text        not null default 'punchy-first-person',
  target_words    integer     not null default 900,

  status          text        not null default 'queued'
                              check (status in ('queued', 'generating', 'publishing',
                                                'published', 'failed')),
  error           text,

  generated       jsonb,      -- {title, slug, excerpt, meta_description, html, tags, ...}
  wp_post_id      integer,
  wp_edit_url     text,
  wp_preview_url  text,
  wp_status       text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists submissions_status_idx on submissions (status);
create index if not exists submissions_created_idx on submissions (created_at desc);

-- One live submission per story. A failed attempt frees the story to be retried.
create unique index if not exists submissions_one_live_per_item
  on submissions (digest_item_id)
  where status in ('queued', 'generating', 'publishing', 'published');

-- ---------------------------------------------------------------------------
-- run_logs :: lightweight audit trail so failures are debuggable from /admin
-- ---------------------------------------------------------------------------
create table if not exists run_logs (
  id         bigserial primary key,
  run_id     uuid,
  scope      text        not null,   -- discover | curate | generate | publish | email
  level      text        not null default 'info'
                         check (level in ('info', 'warn', 'error')),
  message    text        not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists run_logs_created_idx on run_logs (created_at desc);
create index if not exists run_logs_scope_idx on run_logs (scope, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

drop trigger if exists submissions_set_updated_at on submissions;
create trigger submissions_set_updated_at
  before update on submissions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Lock everything down. Only the service role (server-side only) gets through.
-- ---------------------------------------------------------------------------
alter table sources       enable row level security;
alter table authors       enable row level security;
alter table site_profile  enable row level security;
alter table seen_items    enable row level security;
alter table digests       enable row level security;
alter table digest_items  enable row level security;
alter table author_tokens enable row level security;
alter table submissions   enable row level security;
alter table run_logs      enable row level security;

revoke all on all tables in schema public from anon, authenticated;
