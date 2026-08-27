-- ArchiColor AI — схема баллов, лимитов и авторизации по телефону.
--
-- Диалект: MySQL 5.7+ / MariaDB 10.2+ (то, на чём работает Bitrix).
-- Накатывается скриптом tools/archicolor-migrate.php.
--
-- Все DATETIME хранятся в UTC. Сутки бесплатного лимита считаются по МСК —
-- за это отвечает не база, а ac_daily_usage.usage_date, куда PHP кладёт уже
-- посчитанную московскую дату. Так лимит не зависит от таймзоны сервера БД.

-- Пользователь. Идентификатор — номер телефона в формате E.164 (+79991234567).
CREATE TABLE IF NOT EXISTS ac_user (
    id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    phone          VARCHAR(20)     NOT NULL,
    bitrix_user_id INT UNSIGNED    NULL,
    created_at     DATETIME        NOT NULL,
    last_login_at  DATETIME        NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_ac_user_phone (phone),
    KEY idx_ac_user_bitrix (bitrix_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Одноразовые коды подтверждения. Сам код не хранится — только его хеш.
CREATE TABLE IF NOT EXISTS ac_auth_code (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    phone       VARCHAR(20)     NOT NULL,
    code_hash   CHAR(64)        NOT NULL,
    attempts    TINYINT UNSIGNED NOT NULL DEFAULT 0,
    ip          VARCHAR(45)     NULL,
    created_at  DATETIME        NOT NULL,
    expires_at  DATETIME        NOT NULL,
    consumed_at DATETIME        NULL,
    PRIMARY KEY (id),
    KEY idx_ac_auth_code_phone (phone, created_at),
    KEY idx_ac_auth_code_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Сессии. В cookie уходит сам токен, в базе лежит его хеш.
CREATE TABLE IF NOT EXISTS ac_session (
    token_hash CHAR(64)        NOT NULL,
    user_id    BIGINT UNSIGNED NOT NULL,
    ip         VARCHAR(45)     NULL,
    created_at DATETIME        NOT NULL,
    expires_at DATETIME        NOT NULL,
    PRIMARY KEY (token_hash),
    KEY idx_ac_session_user (user_id),
    KEY idx_ac_session_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Баланс баллов. Одна строка на пользователя.
CREATE TABLE IF NOT EXISTS user_balance (
    user_id    BIGINT UNSIGNED NOT NULL,
    balance    INT             NOT NULL DEFAULT 0,
    updated_at DATETIME        NOT NULL,
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- История движений баллов. amount: + начисление, − списание.
--
-- uniq_ac_tx_source — та самая защита от повторного начисления: ЮKassa
-- присылает вебхук повторно при любой сетевой ошибке, и второй INSERT
-- с тем же payment_id обязан упасть, а не удвоить баланс. По той же
-- причине под индекс попадает и кэшбэк с номером заказа.
CREATE TABLE IF NOT EXISTS balance_transactions (
    id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id    BIGINT UNSIGNED NOT NULL,
    amount     INT             NOT NULL,
    type       ENUM('topup', 'cashback', 'spend') NOT NULL,
    source_id  VARCHAR(128)    NULL,
    comment    VARCHAR(255)    NULL,
    created_at DATETIME        NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uniq_ac_tx_source (type, source_id),
    KEY idx_ac_tx_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Счётчик бесплатных генераций за московские сутки.
CREATE TABLE IF NOT EXISTS ac_daily_usage (
    user_id    BIGINT UNSIGNED NOT NULL,
    usage_date DATE            NOT NULL,
    used       INT UNSIGNED    NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Платежи ЮKassa. payment_id — первичный ключ: один платёж, одна строка.
CREATE TABLE IF NOT EXISTS ac_payment (
    payment_id  VARCHAR(64)     NOT NULL,
    user_id     BIGINT UNSIGNED NOT NULL,
    amount_rub  DECIMAL(10, 2)  NOT NULL,
    points      INT UNSIGNED    NOT NULL,
    status      VARCHAR(24)     NOT NULL,
    created_at  DATETIME        NOT NULL,
    captured_at DATETIME        NULL,
    PRIMARY KEY (payment_id),
    KEY idx_ac_payment_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
