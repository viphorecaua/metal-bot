const ExcelJS = require('exceljs');
const { groupAndCompare } = require('./normalize');

async function buildComparisonExcel(normalizedItems) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Metal Price Comparator Bot';
  wb.created = new Date();

  const ws = wb.addWorksheet('Сравнение цен', {
    views: [{ showGridLines: true }],
  });

  ws.columns = [
    { header: 'Профиль / Позиция', key: 'profile', width: 26 },
    { header: 'Поставщик', key: 'supplier', width: 28 },
    { header: 'Цена за кг, грн', key: 'perKg', width: 16 },
    { header: 'Цена за ед. (м / м²), грн', key: 'perUnit', width: 22 },
    { header: 'Теор. вес (кг/м или кг/м²)', key: 'weight', width: 24 },
    { header: 'Оценка / Выгода', key: 'status', width: 20 },
    { header: 'Источник / Примечание', key: 'note', width: 35 },
  ];

  // Стилизация шапки
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FF1A202C' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  const groups = groupAndCompare(normalizedItems);

  for (const group of groups) {
    const hasMultiple = group.items.length > 1;

    for (const it of group.items) {
      const isBest = it.isBest;
      let statusText = 'Базовая цена';
      if (hasMultiple) {
        statusText = isBest ? '🏆 ЛУЧШАЯ ЦЕНА' : `+${it.diffPercent.toFixed(1)}% дороже`;
      }

      const unitPrice = it.pricePerMeter != null ? it.pricePerMeter : it.pricePerSqm;
      const unitLabel = it.unit || 'м';

      const row = ws.addRow({
        profile: it.profileTitle,
        supplier: it.supplier,
        perKg: Number(it.pricePerKg.toFixed(2)),
        perUnit: unitPrice != null ? Number(unitPrice.toFixed(2)) : '',
        weight: Number(it.weightPerMeterOrSqm.toFixed(3)),
        status: statusText,
        note: it.note ? `${it.note} | ${it.label}` : it.label,
      });

      row.height = 20;
      row.alignment = { vertical: 'middle' };

      // Подсветка лучшей цены зеленым цветом
      if (isBest) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD4EDDA' }, // светло-зелёный
          };
        });
        row.getCell('status').font = { bold: true, color: { argb: 'FF155724' } };
      } else if (hasMultiple) {
        row.getCell('status').font = { color: { argb: 'FF721C24' } };
      }
    }

    // Разделитель между разными профилями
    if (groups.length > 1) {
      const sepRow = ws.addRow({});
      sepRow.height = 6;
    }
  }

  // Числовые форматы для колонок
  ws.getColumn('perKg').numFmt = '#,##0.00 "грн"';
  ws.getColumn('perUnit').numFmt = '#,##0.00 "грн"';
  ws.getColumn('weight').numFmt = '#,##0.000 "кг"';

  return wb.xlsx.writeBuffer();
}

module.exports = { buildComparisonExcel };

