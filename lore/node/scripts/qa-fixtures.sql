-- Fixture publications for the standing QA environment (MON-008).
--
-- Applied to the qa D1 database after every deploy by
-- .github/workflows/deploy-qa.yml, so `discover` and `answer` always have
-- known rows a live assertion can name by exact title. Never a real owner's
-- library — everything here is synthetic. Schema mirrors lore/cli.py's
-- _push_sql exactly, since this is a fixture stand-in for a real `lore push`.
DROP TABLE IF EXISTS publications;
CREATE TABLE publications (
  public_id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
  kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '',
  teaser TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
);
INSERT INTO publications(public_id,title,content,kind,topic,teaser,updated_at) VALUES
  ('00000000000000a1bc7c1b5f','QA fixture: cold brew ratio',
   'A synthetic fixture publication seeded by deploy-qa.yml. Content: steep at a 1:8 coffee-to-water ratio for 14 hours at room temperature.',
   'claim','qa-fixtures','What ratio makes the smoothest cold brew?','2026-01-01T00:00:00+00:00'),
  ('00000000000000b2a21a99f7','QA fixture: standing desk break cadence',
   'A synthetic fixture publication seeded by deploy-qa.yml. Content: alternate standing and sitting every 30 minutes for sustained focus.',
   'claim','qa-fixtures','How often should a standing desk user switch positions?','2026-01-01T00:00:00+00:00');
DROP TABLE IF EXISTS node_settings;
CREATE TABLE node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO node_settings(key,value) VALUES ('proxy_preamble','');
INSERT INTO node_settings(key,value) VALUES ('answer_price_usd','0.010000');
INSERT INTO node_settings(key,value) VALUES ('answer_enabled','false');
