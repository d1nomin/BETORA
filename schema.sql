PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mc_nick TEXT NOT NULL COLLATE NOCASE UNIQUE,
  login TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sport TEXT NOT NULL,
  league TEXT NOT NULL,
  team1 TEXT NOT NULL,
  team2 TEXT NOT NULL,
  start_time TEXT NOT NULL,
  odd1 REAL NOT NULL CHECK(odd1 > 1),
  oddx REAL,
  odd2 REAL NOT NULL CHECK(odd2 > 1),
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','live','finished')),
  result TEXT
);
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  match_id INTEGER NOT NULL REFERENCES matches(id),
  pick TEXT NOT NULL CHECK(pick IN ('1','x','2')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  odds REAL NOT NULL CHECK(odds > 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','won','lost')),
  payout INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK(amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS login_attempts (
  login TEXT NOT NULL COLLATE NOCASE,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bets_match ON bets(match_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at DESC);

-- Демонстрационные матчи: время специально задано в будущем относительно даты установки.
INSERT INTO matches(sport,league,team1,team2,start_time,odd1,oddx,odd2,status) VALUES
('football','Ла Лига','Real Madrid','Barcelona','2027-02-14T18:00:00Z',2.10,3.45,3.20,'upcoming'),
('football','АПЛ','Manchester City','Liverpool','2027-02-15T16:30:00Z',1.95,3.70,3.60,'upcoming'),
('football','Лига чемпионов','Bayern Munich','PSG','2027-02-17T20:00:00Z',2.05,3.60,3.25,'upcoming'),
('football','Серия А','Inter','AC Milan','2027-02-18T19:45:00Z',2.15,3.20,3.35,'upcoming'),
('football','АПЛ','Arsenal','Chelsea','2027-02-20T17:30:00Z',1.85,3.65,4.10,'upcoming'),
('football','Лига чемпионов','Atletico Madrid','Borussia Dortmund','2027-02-21T20:00:00Z',2.25,3.30,3.05,'upcoming'),
('cs2','BLAST Premier','NAVI','FaZe Clan','2027-02-14T17:00:00Z',1.85,NULL,1.95,'upcoming'),
('cs2','IEM','Team Spirit','G2 Esports','2027-02-15T14:00:00Z',1.70,NULL,2.10,'upcoming'),
('cs2','ESL Pro League','Vitality','MOUZ','2027-02-16T18:00:00Z',1.65,NULL,2.20,'upcoming'),
('cs2','IEM','FURIA','Astralis','2027-02-17T16:00:00Z',1.90,NULL,1.90,'upcoming'),
('cs2','BLAST Premier','Virtus.pro','Cloud9','2027-02-18T17:00:00Z',2.05,NULL,1.75,'upcoming'),
('cs2','ESL Pro League','The MongolZ','Liquid','2027-02-19T15:00:00Z',1.80,NULL,2.00,'upcoming'),
('dota2','DreamLeague','Team Spirit','Team Liquid','2027-02-14T15:00:00Z',1.90,NULL,1.90,'upcoming'),
('dota2','The International','NAVI','Gaimin Gladiators','2027-02-15T13:00:00Z',2.35,NULL,1.55,'upcoming'),
('dota2','ESL One','Tundra Esports','OG','2027-02-16T16:00:00Z',1.75,NULL,2.05,'upcoming'),
('dota2','DreamLeague','BetBoom Team','Xtreme Gaming','2027-02-17T14:00:00Z',1.85,NULL,1.95,'upcoming'),
('dota2','PGL Wallachia','Aurora','PARIVISION','2027-02-18T15:00:00Z',2.00,NULL,1.80,'upcoming'),
('dota2','ESL One','Team Falcons','Talon Esports','2027-02-19T12:00:00Z',1.60,NULL,2.30,'upcoming');
