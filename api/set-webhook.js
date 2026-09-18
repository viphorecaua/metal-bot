// Открой этот адрес в браузере один раз после деплоя, чтобы подключить бота к Telegram:
// https://<твой-проект>.vercel.app/api/set-webhook
const { Telegraf } = require('telegraf');

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(400).json({
      ok: false,
      error: 'TELEGRAM_BOT_TOKEN не задан в Environment Variables на Vercel',
    });
  }

  try {
    const bot = new Telegraf(token);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const url = `${proto}://${host}/api/webhook`;
    const result = await bot.telegram.setWebhook(url);
    res.status(200).json({ ok: result, webhook: url });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

