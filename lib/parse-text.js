// Парсинг текста сообщений от поставщиков:
// "труба 40х40х2 6 метров - цена 567,64 грн"
// "труба 40х40х2 6м 567.64"
// "труба 40х40х2 цена 45000/т"
// "лист 2мм 1.25х2.5 цена 25000/т"
// "арматура 12 12м 320 грн"
// "уголок 50х50х4 6м 850 грн"

function num(str) {
  if (str == null) return null;
  const cleaned = String(str).replace(',', '.').replace(/\s/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

/**
 * Разбор одной строки текста с позицией металлопроката и ценой.
 */
function parsePriceLine(line, defaultSupplier = null) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('/')) return null;

  const raw = trimmed.toLowerCase().replace(/[хx]/g, 'x');

  // Определение поставщика в начале строки (например, "Метал Холдинг: труба 40х40х2...")
  let supplier = defaultSupplier;
  let textToParse = trimmed;
  const suppPrefixMatch = trimmed.match(/^(?:постачальник|поставщик|поставщик\s*1|поставщик\s*2)?[:\s]*["«]?([^"»:\n]+)["»]?\s*:\s*(.+)$/i);
  if (suppPrefixMatch && /труба|лист|арматур|круг|кутник|уголок|\dx\d/i.test(suppPrefixMatch[2])) {
    supplier = suppPrefixMatch[1].trim();
    textToParse = suppPrefixMatch[2].trim();
  }

  const rawClean = textToParse.toLowerCase().replace(/[хx]/g, 'x');

  // 1. Длина в метрах
  const lengthMatch = rawClean.match(/(\d+(?:[.,]\d+)?)\s*(?:м|метр|метра|метров|пог\.?\s*м)(?!\s*м)/iu);
  const length = lengthMatch ? num(lengthMatch[1]) : null;

  // 2. База цены и сумма
  const perTonHint = /\/\s*т(?:\s|$|[^\p{L}])|за\s*тонн/iu.test(rawClean);
  const perMeterHint = /\/\s*м(?:\s|$|[^\p{L}])|за\s*метр/iu.test(rawClean);

  let price = null;
  let priceBasis = 'unknown';

  // Поиск цены по различным паттернам
  const priceWithTonMatch = rawClean.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(?:грн|uah|₴)?\s*(?:\/\s*т|за\s*тонн)/iu);
  const priceWithMeterMatch = rawClean.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(?:грн|uah|₴)?\s*(?:\/\s*м|за\s*метр)/iu);
  const priceWithCurrencyMatch = rawClean.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(?:грн|uah|₴)/iu);
  const priceAfterWordMatch = rawClean.match(/(?:ціна|цена|стоимость|по|–|-)\s*[:=-]?\s*(\d[\d\s]*(?:[.,]\d+)?)/iu);

  if (priceWithTonMatch) {
    price = num(priceWithTonMatch[1]);
    priceBasis = 'per_ton';
  } else if (priceWithMeterMatch) {
    price = num(priceWithMeterMatch[1]);
    priceBasis = 'per_meter';
  } else if (priceWithCurrencyMatch) {
    price = num(priceWithCurrencyMatch[1]);
    priceBasis = perTonHint ? 'per_ton' : perMeterHint ? 'per_meter' : (length ? 'total_for_length' : 'unknown');
  } else if (priceAfterWordMatch) {
    price = num(priceAfterWordMatch[1]);
    priceBasis = perTonHint ? 'per_ton' : perMeterHint ? 'per_meter' : (length ? 'total_for_length' : 'unknown');
  } else if (perTonHint) {
    const trailingNum = rawClean.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*$/);
    if (trailingNum) {
      price = num(trailingNum[1]);
      priceBasis = 'per_ton';
    }
  }

  if (price == null || price <= 0) return null;

  // 3. Определение типа профиля и размеров
  let profile = null;
  const isSheet = /лист/.test(rawClean);
  const isRebar = /арматур|круг\b|пруток/iu.test(rawClean);
  const isAngle = /кутник|уголок|куток/iu.test(rawClean);
  const isRound = /кругл|труба\s*кр|ø|d\s*=|диам/iu.test(rawClean);

  if (isSheet) {
    const thMatch = rawClean.match(/лист[а-я]*\s*(?:г\/?к|х\/?к|оц(?:инк)?)?\s*(\d+(?:[.,]\d+)?)\s*(?:мм)?/iu);
    if (thMatch) {
      profile = { type: 'sheet', dims: { thickness: num(thMatch[1]) } };
    }
  } else if (isRebar) {
    const rebarMatch = rawClean.match(/(?:арматур[а-я]*|круг|пруток)\s*(?:ф|ø|d|№)?\s*(\d+(?:[.,]\d+)?)/iu);
    if (rebarMatch) {
      profile = { type: 'rebar', dims: { d: num(rebarMatch[1]) } };
    }
  } else if (isAngle) {
    const angleMatch = rawClean.match(/(?:кутник|уголок|куток)\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))?/iu);
    if (angleMatch) {
      const a = num(angleMatch[1]);
      const b = angleMatch[3] ? num(angleMatch[2]) : a;
      const s = angleMatch[3] ? num(angleMatch[3]) : num(angleMatch[2]);
      profile = { type: 'angle', dims: { a, b, s } };
    }
  }

  // Если профиль ещё не определён, ищем трубы (3 размера или 2 размера)
  if (!profile) {
    const dims3 = rawClean.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/);
    const dims2 = rawClean.match(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/);

    if (dims3) {
      profile = {
        type: 'pipe_profile',
        dims: { a: num(dims3[1]), b: num(dims3[2]), s: num(dims3[3]) },
      };
    } else if (dims2) {
      if (isRound || !isSheet) {
        profile = {
          type: 'pipe_round',
          dims: { D: num(dims2[1]), s: num(dims2[2]) },
        };
      }
    }
  }

  if (!profile) return null;

  return {
    source: 'text',
    supplier: supplier || 'Сообщение',
    label: textToParse,
    profile,
    price,
    priceBasis,
    length,
  };
}

/**
 * Разбор текста сообщения (может содержать одну или несколько строк).
 */
function parsePriceMessage(text, defaultSupplier = null) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results = [];

  for (const line of lines) {
    const parsed = parsePriceLine(line, defaultSupplier);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results;
}

module.exports = { parsePriceLine, parsePriceMessage, num };
