// Разбор OCR-текста накладной (включая украинские накладные с ценами за тонну и спецификацией).

function toNumber(s) {
  if (s == null) return null;
  const cleaned = String(s).replace(/\s/g, '').replace(',', '.');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

// Находит все "денежные"/числовые токены вида "45 125,00", "541,50", "0,06" в строке.
function extractNumbers(line) {
  const matches = line.match(/\d{1,3}(?:[ \u00A0]\d{3})*(?:[.,]\d+)?/g) || [];
  return matches.map(toNumber).filter((n) => n != null);
}

// Извлекает название поставщика из шапки накладной (например, "МЕТАЛ ХОЛДІНГ ТРЕЙД")
function extractSupplierName(ocrText) {
  if (!ocrText) return null;
  const lines = ocrText.split('\n');
  for (const line of lines) {
    if (/постачальник|поставщик/i.test(line)) {
      const quoteMatch = line.match(/["«]([^"»\n]+)["»]/);
      if (quoteMatch && quoteMatch[1]) {
        return quoteMatch[1].trim();
      }
      const rawMatch = line.replace(/постачальник[:\s]*|поставщик[:\s]*/i, '').trim();
      if (rawMatch.length > 3) {
        return rawMatch.slice(0, 50);
      }
    }
  }
  return null;
}

function parseInvoiceText(ocrText) {
  const lines = (ocrText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const supplier = extractSupplierName(ocrText) || 'Поставщик (накладная)';
  const items = [];
  const unparsed = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    const isPipe = /труба/.test(lower);
    const isSheet = /лист/.test(lower);
    const isRebar = /арматур|круг\b|пруток/iu.test(lower);
    const isAngle = /кутник|уголок|куток/iu.test(lower);

    if (!isPipe && !isSheet && !isRebar && !isAngle) {
      continue;
    }

    // Ищем вес в тоннах (или кг) с безопасной Unicode-границей
    const weightMatch = line.match(/(\d+(?:[.,]\d+)?)\s*(?:т|тонн|t|tn)(?:\s|$|[^\p{L}])/iu);
    const weightKgMatch = !weightMatch ? line.match(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg)(?:\s|$|[^\p{L}])/iu) : null;

    let weightTons = null;
    let matchEndIndex = -1;

    if (weightMatch) {
      weightTons = toNumber(weightMatch[1]);
      matchEndIndex = weightMatch.index + weightMatch[0].length;
    } else if (weightKgMatch) {
      weightTons = toNumber(weightKgMatch[1]) / 1000;
      matchEndIndex = weightKgMatch.index + weightKgMatch[0].length;
    }

    // Ищем цену за тонну строго ПОСЛЕ указания веса в строке
    let pricePerTon = null;
    if (matchEndIndex > 0) {
      const afterWeightStr = line.slice(matchEndIndex);
      const numsAfter = extractNumbers(afterWeightStr);
      // В типовой накладной порядок колонок: [Кількість, т] [Ціна без ПДВ] [ПДВ] [Сума]
      if (numsAfter.length > 0) {
        pricePerTon = numsAfter[0];
      }
    }

    // Распознаём профиль
    let profile = null;

    if (isPipe) {
      // 1. Профильная труба: 3 размера (например, 40x40x2 или 40x20x2)
      const dims3 = line.match(/(?:труба\s+)?(\d+(?:[.,]\d+)?)\s*[xх*]\s*(\d+(?:[.,]\d+)?)\s*[xх*]\s*(\d+(?:[.,]\d+)?)/i);
      if (dims3) {
        profile = {
          type: 'pipe_profile',
          dims: { a: toNumber(dims3[1]), b: toNumber(dims3[2]), s: toNumber(dims3[3]) },
        };
      } else {
        // 2. Круглая труба: 2 размера (например, труба 40х2 или ф40х2)
        const dims2 = line.match(/труба\s+(?:ф|ø|d|диам\.?\s*)?(\d+(?:[.,]\d+)?)\s*[xх*]\s*(\d+(?:[.,]\d+)?)/i);
        if (dims2) {
          profile = {
            type: 'pipe_round',
            dims: { D: toNumber(dims2[1]), s: toNumber(dims2[2]) },
          };
        }
      }
    } else if (isSheet) {
      const thMatch = line.match(/лист\s+(\d+(?:[.,]\d+)?)/i);
      if (thMatch) {
        profile = {
          type: 'sheet',
          dims: { thickness: toNumber(thMatch[1]) },
        };
      }
    } else if (isRebar) {
      const rebarMatch = line.match(/(?:арматур[а-я]*|круг|пруток)\s*(?:ф|ø|d|диам\.?\s*|№)?\s*(\d+(?:[.,]\d+)?)/iu);
      if (rebarMatch) {
        profile = {
          type: 'rebar',
          dims: { d: toNumber(rebarMatch[1]) },
        };
      }
    } else if (isAngle) {
      const angleMatch = line.match(/(?:кутник|уголок|куток)\s*(\d+(?:[.,]\d+)?)\s*[xх*]\s*(\d+(?:[.,]\d+)?)(?:\s*[xх*]\s*(\d+(?:[.,]\d+)?))?/iu);
      if (angleMatch) {
        profile = {
          type: 'angle',
          dims: {
            a: toNumber(angleMatch[1]),
            b: angleMatch[3] ? toNumber(angleMatch[2]) : toNumber(angleMatch[1]),
            s: angleMatch[3] ? toNumber(angleMatch[3]) : toNumber(angleMatch[2]),
          },
        };
      }
    }

    if (!profile || weightTons == null || pricePerTon == null) {
      unparsed.push(line);
      continue;
    }

    items.push({
      source: 'invoice',
      supplier,
      label: line,
      profile,
      weightTons,
      pricePerTon,
    });
  }

  return { items, unparsed, supplier };
}

module.exports = { parseInvoiceText, extractSupplierName, extractNumbers, toNumber };
