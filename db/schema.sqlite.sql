-- ArchiColor AI — та же схема на SQLite.
--
-- Нужна для локальной разработки и автотестов (tools/archicolor-test-balance.php):
-- поднимать MySQL ради проверки логики лимитов необязательно.
-- Боевая схема — db/schema.mysql.sql, держите файлы в согласии.
--
-- Важно: рабочие запросы кода одинаковы для обоих диалектов. Атомарность
-- живёт в самих запросах (UPDATE ... WHERE used < :limit и
-- UPDATE ... WHERE balance >= :price), а не в возможностях конкретной СУБД.

CREATE TABLE IF NOT EXISTS ac_user (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    phone          TEXT    NOT NULL UNIQUE,
    bitrix_user_id INTEGER NULL,
    created_at     TEXT    NOT NULL,
    last_login_at  TEXT    NULL
);

CREATE TABLE IF NOT EXISTS ac_auth_code (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT    NOT NULL,
    code_hash   TEXT    NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    ip          TEXT    NULL,
    created_at  TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    consumed_at TEXT    NULL
);
CREATE INDEX IF NOT EXISTS idx_ac_auth_code_phone ON ac_auth_code (phone, created_at);
CREATE INDEX IF NOT EXISTS idx_ac_auth_code_ip ON ac_auth_code (ip, created_at);

CREATE TABLE IF NOT EXISTS ac_session (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    ip         TEXT    NULL,
    created_at TEXT    NOT NULL,
    expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ac_session_user ON ac_session (user_id);

CREATE TABLE IF NOT EXISTS user_balance (
    user_id    INTEGER PRIMARY KEY,
    balance    INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS balance_transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    amount     INTEGER NOT NULL,
    type       TEXT    NOT NULL CHECK (type IN ('topup', 'cashback', 'spend')),
    source_id  TEXT    NULL,
    comment    TEXT    NULL,
    created_at TEXT    NOT NULL
);
-- Защита от повторного начисления по одному и тому же платежу или заказу.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ac_tx_source ON balance_transactions (type, source_id);
CREATE INDEX IF NOT EXISTS idx_ac_tx_user ON balance_transactions (user_id, created_at);

CREATE TABLE IF NOT EXISTS ac_daily_usage (
    user_id    INTEGER NOT NULL,
    usage_date TEXT    NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS ac_payment (
    payment_id  TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    amount_rub  REAL    NOT NULL,
    points      INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    captured_at TEXT    NULL
);
CREATE INDEX IF NOT EXISTS idx_ac_payment_user ON ac_payment (user_id, created_at);
