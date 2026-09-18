// Хранит список позиций по chatId до нажатия "Начать анализ".
// Использует Upstash Redis через официальный REST API (POST c JSON-массивом).

async function redis(command) {
  const base = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL или UPSTASH_REDIS_REST_TOKEN не заданы в переменных окружения');
  }

  const url = base.replace(/\/+$/, '');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Upstash Redis error: ${data.error}`);
  }
  return data.result;
}

function key(chatId) {
  return `metalbot:buffer:${chatId}`;
}

async function addItem(chatId, item) {
  await addItems(chatId, [item]);
}

async function addItems(chatId, items) {
  if (!items || items.length === 0) return;
  const serialized = items.map((it) => JSON.stringify(it));
  await redis(['RPUSH', key(chatId), ...serialized]);
  await redis(['EXPIRE', key(chatId), '86400']); // буфер живёт сутки
}

async function getItems(chatId) {
  const raw = (await redis(['LRANGE', key(chatId), '0', '-1'])) || [];
  return raw.map((s) => JSON.parse(s));
}

async function clearItems(chatId) {
  await redis(['DEL', key(chatId)]);
}

module.exports = { addItem, addItems, getItems, clearItems };

