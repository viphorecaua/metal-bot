const { weightByProfile, getProfileKey, formatProfileTitle } = require('./weight-calc');

/**
 * Приводит позицию к цене за кг и метр/м2.
 * Поддерживает накладные (цена за тонну) и текст (за длину, за тонну, за метр).
 * Возвращает { ...item, profileKey, profileTitle, pricePerKg, pricePerMeter, pricePerSqm, weightPerMeterOrSqm, unit } либо null.
 */
function normalizeItem(item) {
  if (!item || !item.profile) return null;

  const w = weightByProfile(item.profile); // кг/м либо кг/м2 (для листа)
  if (w == null || !isFinite(w) || w <= 0) return null;

  let pricePerKg = null;
  let note = '';

  if (item.source === 'invoice') {
    // pricePerTon - грн за тонну без ПДВ
    pricePerKg = item.pricePerTon / 1000;
    note = 'из накладной (без ПДВ)';
  } else if (item.source === 'text') {
    if (item.priceBasis === 'per_ton') {
      pricePerKg = item.price / 1000;
      note = 'цена за тонну';
    } else if (item.priceBasis === 'total_for_length' && item.length) {
      const totalWeightKg = w * item.length;
      pricePerKg = item.price / totalWeightKg;
      note = `${item.length}м за ${item.price} грн`;
    } else if (item.priceBasis === 'per_meter') {
      pricePerKg = item.price / w;
      note = 'цена за метр';
    } else {
      return null;
    }
  }

  if (pricePerKg == null || !isFinite(pricePerKg) || pricePerKg <= 0) return null;

  const isSheet = item.profile.type === 'sheet';
  const unit = isSheet ? 'м²' : 'м';
  const pricePerMeter = isSheet ? null : pricePerKg * w;
  const pricePerSqm = isSheet ? pricePerKg * w : null;
  const profileKey = getProfileKey(item.profile);
  const profileTitle = formatProfileTitle(item.profile);
  const supplier = item.supplier || (item.source === 'invoice' ? 'Накладная' : 'Сообщение');

  return {
    ...item,
    supplier,
    profileKey,
    profileTitle,
    weightPerMeterOrSqm: w,
    unit,
    pricePerKg,
    pricePerMeter,
    pricePerSqm,
    note,
  };
}

/**
 * Группирует нормализованные позиции по профилю (например, все трубы 40х40х2 вместе)
 * и ранжирует поставщиков от самого выгодного к дорогому.
 */
function groupAndCompare(normalizedItems) {
  const groups = new Map();

  for (const item of normalizedItems) {
    if (!groups.has(item.profileKey)) {
      groups.set(item.profileKey, {
        profileKey: item.profileKey,
        profileTitle: item.profileTitle,
        unit: item.unit,
        weightPerUnit: item.weightPerMeterOrSqm,
        items: [],
      });
    }
    groups.get(item.profileKey).items.push(item);
  }

  const resultGroups = [];

  for (const group of groups.values()) {
    // Сортируем внутри группы от дешевого к дорогому
    group.items.sort((a, b) => a.pricePerKg - b.pricePerKg);
    const bestPrice = group.items[0].pricePerKg;

    group.items.forEach((it, idx) => {
      it.isBest = idx === 0 && group.items.length > 1;
      if (idx > 0) {
        it.diffPercent = ((it.pricePerKg - bestPrice) / bestPrice) * 100;
        it.diffPerKg = it.pricePerKg - bestPrice;
      } else {
        it.diffPercent = 0;
        it.diffPerKg = 0;
      }
    });

    resultGroups.push(group);
  }

  return resultGroups;
}

module.exports = { normalizeItem, groupAndCompare };

