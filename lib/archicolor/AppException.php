<?php
/**
 * ArchiColor AI — ошибка, которую можно показать клиенту.
 *
 * У ошибки есть машинный код (для фронтенда), человеческий текст (для клиента)
 * и, отдельно, техническая подробность — она уходит только в лог, а клиенту
 * показывается лишь при включённом debug.
 */

namespace ArchiColor;

class AppException extends \Exception
{
    /** @var string */
    private $errorCode;
    /** @var string */
    private $detail;
    /** @var int */
    private $status;

    public function __construct($code, $message, $status = 400, $detail = '')
    {
        parent::__construct($message);
        $this->errorCode = (string) $code;
        $this->detail = (string) $detail;
        $this->status = (int) $status;
    }

    public function errorCode()
    {
        return $this->errorCode;
    }

    public function detail()
    {
        return $this->detail;
    }

    public function status()
    {
        return $this->status;
    }
}
