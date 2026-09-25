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

    // 1. Распознаём профиль
    let profile = null;

    if (isPipe) {
      // Профильная труба: 3 размера (например, 40x40x2 или 40x20x2)
      const dims3 = line.match(/(?:труба\s+)?(\d+(?:[.,]\d+)?)\s*[xх*×]\s*(\d+(?:[.,]\d+)?)\s*[xх*×]\s*(\d+(?:[.,]\d+)?)/iu);
      if (dims3) {
        profile = {
          type: 'pipe_profile',
          dims: { a: toNumber(dims3[1]), b: toNumber(dims3[2]), s: toNumber(dims3[3]) },
        };
      } else {
        // Круглая труба: 2 размера (например, труба 40х2 или ф40х2)
        const dims2 = line.match(/труба\s+(?:ф|ø|d|диам\.?\s*)?(\d+(?:[.,]\d+)?)\s*[xх*×]\s*(\d+(?:[.,]\d+)?)/iu);
        if (dims2) {
          profile = {
            type: 'pipe_round',
            dims: { D: toNumber(dims2[1]), s: toNumber(dims2[2]) },
          };
        }
      }
    } else if (isSheet) {
      const thMatch = line.match(/лист\s+(\d+(?:[.,]\d+)?)/iu);
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
      const angleMatch = line.match(/(?:кутник|уголок|куток)\s*(\d+(?:[.,]\d+)?)\s*[xх*×]\s*(\d+(?:[.,]\d+)?)(?:\s*[xх*×]\s*(\d+(?:[.,]\d+)?))?/iu);
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

    // 2. Ищем вес и цену за тонну
    let weightTons = null;
    let pricePerTon = null;

    // Способ А: Ячейки таблицы (если строка содержит знаки табуляции от OCR таблицы)
    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 3) {
      for (let i = 0; i < cells.length; i++) {
        const cellNum = toNumber(cells[i]);
        if (cellNum && cellNum >= 5000 && cellNum <= 300000) {
          pricePerTon = cellNum;
          if (i > 0) {
            const prevNum = toNumber(cells[i - 1]);
            if (prevNum && prevNum > 0 && prevNum < 1000) {
              weightTons = prevNum;
              break;
            }
          }
        }
      }
    }

    // Способ Б: Явный маркер веса "0.06 т" / "0.06 т." / "150 кг"
    if (weightTons == null) {
      const weightMatch = line.match(/(\d+(?:[.,]\d+)?)\s*(?:т|тонн|t|tn)(?:\s|$|[^\p{L}])/iu);
      const weightKgMatch = !weightMatch ? line.match(/(\d+(?:[.,]\d+)?)\s*(?:кг|kg)(?:\s|$|[^\p{L}])/iu) : null;

      if (weightMatch) {
        weightTons = toNumber(weightMatch[1]);
        const afterWeightStr = line.slice(weightMatch.index + weightMatch[0].length);
        const numsAfter = extractNumbers(afterWeightStr);
        if (numsAfter.length > 0) {
          pricePerTon = numsAfter.find((n) => n >= 5000) || numsAfter[0];
        }
      } else if (weightKgMatch) {
        weightTons = toNumber(weightKgMatch[1]) / 1000;
        const afterWeightStr = line.slice(weightKgMatch.index + weightKgMatch[0].length);
        const numsAfter = extractNumbers(afterWeightStr);
        if (numsAfter.length > 0) {
          pricePerTon = numsAfter.find((n) => n >= 5000) || numsAfter[0];
        }
      }
    }

    // Способ В: По списку чисел в строке (находим цену за тонну > 5000 и вес перед ней)
    if (weightTons == null || pricePerTon == null) {
      const allNums = extractNumbers(line);
      const priceIdx = allNums.findIndex((n) => n >= 5000 && n <= 300000);
      if (priceIdx > 0) {
        pricePerTon = allNums[priceIdx];
        for (let j = priceIdx - 1; j >= 0; j--) {
          const candidate = allNums[j];
          if (candidate > 0 && candidate < 500) {
            weightTons = candidate;
            break;
          }
        }
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
