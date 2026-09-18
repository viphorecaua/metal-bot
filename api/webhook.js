const { Telegraf, Markup } = require('telegraf');
const { parsePriceMessage } = require('../lib/parse-text');
const { parseInvoiceText } = require('../lib/parse-invoice');
const { recognizeImageText } = require('../lib/ocr');
const { normalizeItem, groupAndCompare } = require('../lib/normalize');
const { formatProfileTitle } = require('../lib/weight-calc');
const { buildComparisonExcel } = require('../lib/excel');
const store = require('../lib/buffer-store');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || 'MISSING_TOKEN');

const ANALYZE_KB = Markup.inlineKeyboard([
  Markup.button.callback('🔍 Начать анализ', 'start_analysis'),
  Markup.button.callback('📋 Текущий буфер', 'view_buffer'),
  Markup.button.callback('🗑 Сбросить', 'reset_buffer'),
]);

function getSenderName(ctx) {
  const msg = ctx.message;
  if (!msg) return null;
  if (msg.forward_sender_name) return msg.forward_sender_name;
  if (msg.forward_from) {
    return [msg.forward_from.first_name, msg.forward_from.last_name].filter(Boolean).join(' ') || msg.forward_from.username;
  }
  if (msg.forward_from_chat) {
    return msg.forward_from_chat.title;
  }
  return null;
}

bot.start((ctx) =>
  ctx.reply(
    '👋 Привет! Я бот для сравнения цен на металлопрокат.\n\n' +
      '📥 Как пользоваться:\n' +
      '1. Пересылай сообщения с ценами от поставщиков или пиши их вручную:\n' +
      '   • "труба 40х40х2 6м 567,64 грн"\n' +
      '   • "труба 40х40х2 цена 45000/т"\n' +
      '   • "лист 2мм 1.25х2.5 25000/т"\n' +
      '   • "арматура 12 12м 320 грн"\n' +
      '   (можно отправлять списком из нескольких строк сразу!)\n\n' +
      '2. Либо отправляй фото или PDF накладных (например, от «Метал Холдинг»).\n\n' +
      '3. Нажми «🔍 Начать анализ» — я приведу все позиции к цене за 1 кг и 1 метр, сопоставлю одинаковые позиции между поставщиками и пришлю Excel-отчёт.'
  )
);

bot.command('reset', async (ctx) => {
  await store.clearItems(ctx.chat.id);
  ctx.reply('🗑 Буфер предложений очищен.');
});

bot.command('status', async (ctx) => {
  await showCurrentBuffer(ctx);
});

async function showCurrentBuffer(ctx) {
  const items = await store.getItems(ctx.chat.id);
  if (!items || items.length === 0) {
    return ctx.reply('Буфер пуст. Отправьте цены текстом или фото/PDF накладной.');
  }
  let msg = `📋 В буфере ${items.length} предложений:\n\n`;
  items.forEach((it, idx) => {
    const title = it.profile ? formatProfileTitle(it.profile) : it.label;
    const supp = it.supplier ? ` [${it.supplier}]` : '';
    msg += `${idx + 1}. ${title}${supp}\n`;
  });
  await ctx.reply(msg, ANALYZE_KB);
}

// Обработка текстовых сообщений
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const supplier = getSenderName(ctx);
  const results = parsePriceMessage(ctx.message.text, supplier);

  if (!results || results.length === 0) {
    return ctx.reply(
      '⚠️ Не смог распознать размер или цену металлопроката.\n\n' +
        'Примеры форматов:\n' +
        '• "труба 40х40х2 6 метров - цена 567,64 грн"\n' +
        '• "труба 40х40х2 цена 45000/т"\n' +
        '• "лист 2мм 1.25х2.5 25000/т"\n' +
        '• "арматура 12 12м 320 грн"\n\n' +
        'Можно также отправить сразу несколько строк.'
    );
  }

  await store.addItems(ctx.chat.id, results);
  const count = (await store.getItems(ctx.chat.id)).length;

  if (results.length === 1) {
    const it = results[0];
    const title = it.profile ? formatProfileTitle(it.profile) : it.label;
    ctx.reply(`✅ Добавлено: ${title} (${it.supplier})\nВсего в буфере: ${count}`, ANALYZE_KB);
  } else {
    let msg = `✅ Добавлено ${results.length} позиций (всего в буфере: ${count}):\n`;
    msg += results.map((r) => `• ${formatProfileTitle(r.profile)}`).join('\n');
    ctx.reply(msg, ANALYZE_KB);
  }
});

// Общая функция обработки фото / PDF
async function handleInvoiceFile(ctx, fileId, fileTypeDesc) {
  await ctx.reply(`⏳ Распознаю ${fileTypeDesc} через OCR…`);
  try {
    const link = await ctx.telegram.getFileLink(fileId);
    const text = await recognizeImageText(link.href);
    const { items, unparsed, supplier } = parseInvoiceText(text);

    if (items.length > 0) {
      await store.addItems(ctx.chat.id, items);
    }

    const count = (await store.getItems(ctx.chat.id)).length;
    let msg = `✅ Распознано ${items.length} позиций от «${supplier}» (всего в буфере: ${count}):\n\n`;
    msg += items.map((i) => `• ${formatProfileTitle(i.profile)} — ${(i.pricePerTon / 1000).toFixed(2)} грн/кг`).join('\n') || '(позиции металлопроката не найдены)';

    if (unparsed.length) {
      msg += `\n\n⚠️ Не удалось автоматически разобрать ${unparsed.length} строк(и). При необходимости отправьте их текстом вручную.`;
    }

    ctx.reply(msg, ANALYZE_KB);
  } catch (e) {
    ctx.reply('❌ Ошибка при распознавании документа: ' + e.message);
  }
}

// Обработка фото
bot.on('photo', async (ctx) => {
  const photos = ctx.message.photo;
  const fileId = photos[photos.length - 1].file_id;
  await handleInvoiceFile(ctx, fileId, 'фото накладной');
});

// Обработка документов (PDF или несжатые изображения)
bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  const isPdf = doc.mime_type === 'application/pdf' || (doc.file_name && doc.file_name.toLowerCase().endsWith('.pdf'));
  const isImg = doc.mime_type && doc.mime_type.startsWith('image/');

  if (isPdf || isImg) {
    await handleInvoiceFile(ctx, doc.file_id, isPdf ? 'PDF-накладную' : 'документ');
  } else {
    ctx.reply('Пожалуйста, отправьте накладную как фото или файл в формате PDF.');
  }
});

bot.action('reset_buffer', async (ctx) => {
  await store.clearItems(ctx.chat.id);
  await ctx.answerCbQuery('Очищено');
  ctx.reply('🗑 Буфер предложений очищен.');
});

bot.action('view_buffer', async (ctx) => {
  await ctx.answerCbQuery();
  await showCurrentBuffer(ctx);
});

bot.action('start_analysis', async (ctx) => {
  await ctx.answerCbQuery('Анализирую предложения…');
  const items = await store.getItems(ctx.chat.id);

  if (items.length < 2) {
    return ctx.reply('⚠️ В буфере меньше двух предложений. Добавьте ещё варианты от поставщиков для сравнения.');
  }

  const normalized = items.map(normalizeItem).filter(Boolean);
  const skipped = items.length - normalized.length;

  if (normalized.length < 2) {
    return ctx.reply('⚠️ Не хватило данных для расчёта цен за кг (не удалось вычислить вес для большинства позиций).');
  }

  const groups = groupAndCompare(normalized);

  let msg = '📊 РЕЗУЛЬТАТЫ СРАВНЕНИЯ ЦЕН:\n\n';

  for (const group of groups) {
    const isSheet = group.unit === 'м²';
    const unitLabel = isSheet ? 'м²' : 'м';
    const weightLabel = isSheet ? `${group.weightPerUnit.toFixed(2)} кг/м²` : `${group.weightPerUnit.toFixed(3)} кг/м`;

    msg += `🔹 ${group.profileTitle} (теор. вес: ${weightLabel})\n`;

    group.items.forEach((it, idx) => {
      const unitPriceStr = it.pricePerMeter != null ? ` (${it.pricePerMeter.toFixed(2)} грн/${unitLabel})` : (it.pricePerSqm != null ? ` (${it.pricePerSqm.toFixed(2)} грн/м²)` : '');
      if (it.isBest) {
        msg += `  🟢 ${it.pricePerKg.toFixed(2)} грн/кг${unitPriceStr} — ${it.supplier} 🏆 ЛУЧШАЯ ЦЕНА\n`;
      } else if (group.items.length > 1 && idx > 0) {
        msg += `  🔴 ${it.pricePerKg.toFixed(2)} грн/кг${unitPriceStr} — ${it.supplier} (+${it.diffPercent.toFixed(1)}% дороже)\n`;
      } else {
        msg += `  • ${it.pricePerKg.toFixed(2)} грн/кг${unitPriceStr} — ${it.supplier}\n`;
      }
    });
    msg += '\n';
  }

  if (skipped) {
    msg += `(⚠️ ${skipped} позиций пропущено — не удалось определить профиль)\n\n`;
  }

  msg += '📄 Сформирован детальный Excel-файл со всеми позициями и выгодой:';

  await ctx.reply(msg);

  try {
    const buffer = await buildComparisonExcel(normalized);
    await ctx.replyWithDocument({
      source: Buffer.from(buffer),
      filename: 'Сравнение_цен_металлопрокат.xlsx',
    });
  } catch (err) {
    console.error('Excel build error:', err);
    ctx.reply('Не удалось сформировать Excel-файл: ' + err.message);
  }

  await store.clearItems(ctx.chat.id);
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(200).send('Metal Bot Webhook is running. Use Telegram to interact.');
  }
  if (!req.body) {
    return res.status(400).send('No body');
  }
  try {
    await bot.handleUpdate(req.body);
  } catch (e) {
    console.error('Webhook handleUpdate error:', e);
  }
  res.status(200).end();
};

