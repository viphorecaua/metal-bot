const assert = require('assert');
const { parseInvoiceText } = require('../lib/parse-invoice');
const { parsePriceMessage, parsePriceLine } = require('../lib/parse-text');
const { weightByProfile, getProfileKey, formatProfileTitle } = require('../lib/weight-calc');
const { normalizeItem } = require('../lib/normalize');

console.log('--- Начинаем тестирование парсеров и калькулятора ---');

// 1. Тест реальной накладной пользователя (Метал Холдинг Трейд)
const sampleInvoiceOcr = `
Рахунок на оплату № ХАХК-010669 від 17 вересня 2026
Постачальник: Харківська філія товариства з обмеженою відповідальністю "МЕТАЛ ХОЛДІНГ ТРЕЙД"
№ Товар Кіл-сть Од. Ціна без ПДВ ПДВ Сума без ПДВ Код УКТЗЕД Довжина Примітка
1 Труба 40x40x2 (6,05- 8940:2019 08кп/1-3пс) 0,06 т 45 125,00 541,50 2 707,50 7306 6,05 24 м ; 4 рез. (по 3 м)
2 Труба 40x20x2 (6,03 8645-68 1-3 пс) 0,011 т 45 561,82 100,24 501,18 7306 6,03 6 м; 1 рез. (по 3 м)
3 Труба 20x20x2 (6,05- 8940:2019 08кп/1-3пс) 0,017 т 47 291,18 160,79 803,95 7306 6,05 15 м; 3 рез. (по 3 м)
4 Труба 40x40x1,5 (6,05- 8940:2019 08кп/пс/1-3пс) 0,196 т 58 494,13 2 292,97 11 464,85 7306 6,05 105 м на 24.09; 17 рез. (по 3 м)
5 Лист 1 (оц.) ((1,0*2,0) DX51D+Z140) 0,17 т 51 670,83 1 756,81 8 784,04 7210 49 00 00 2 10 л
Разом: 24 261,52
`;

const invoiceResult = parseInvoiceText(sampleInvoiceOcr);
assert.strictEqual(invoiceResult.supplier, 'МЕТАЛ ХОЛДІНГ ТРЕЙД', 'Поставщик должен быть извлечен из шапки');
assert.strictEqual(invoiceResult.items.length, 5, 'Должны быть распознаны все 5 позиций');
assert.strictEqual(invoiceResult.unparsed.length, 0, 'Не должно остаться нераспознанных строк металла');

// Проверка первой строки (Труба 40x40x2)
const item1 = invoiceResult.items[0];
assert.strictEqual(item1.profile.type, 'pipe_profile');
assert.strictEqual(item1.profile.dims.a, 40);
assert.strictEqual(item1.profile.dims.b, 40);
assert.strictEqual(item1.profile.dims.s, 2);
assert.strictEqual(item1.weightTons, 0.06);
assert.strictEqual(item1.pricePerTon, 45125.0);

// Проверка листа
const item5 = invoiceResult.items[4];
assert.strictEqual(item5.profile.type, 'sheet');
assert.strictEqual(item5.profile.dims.thickness, 1);
assert.strictEqual(item5.weightTons, 0.17);
assert.strictEqual(item5.pricePerTon, 51670.83);

console.log('✔ Тест реальной накладной пройден: 5 позиций и поставщик распознаны точно');

// 2. Тест парсинга текстовых сообщений
const text1 = parsePriceLine('труба 40х40х2 6 метров - цена 567,64 грн');
assert.ok(text1, 'Должно распознать трубу 40х40х2 с ценой и длиной');
assert.strictEqual(text1.profile.type, 'pipe_profile');
assert.strictEqual(text1.length, 6);
assert.strictEqual(text1.price, 567.64);
assert.strictEqual(text1.priceBasis, 'total_for_length');

const text2 = parsePriceLine('труба 40х40х2 цена 45000/т');
assert.ok(text2, 'Должно распознать цену за тонну без явного слова грн');
assert.strictEqual(text2.price, 45000);
assert.strictEqual(text2.priceBasis, 'per_ton');

const text3 = parsePriceLine('лист 2мм 1.25х2.5 цена 25000/т');
assert.ok(text3, 'Должно распознать лист');
assert.strictEqual(text3.profile.type, 'sheet');
assert.strictEqual(text3.profile.dims.thickness, 2);
assert.strictEqual(text3.price, 25000);
assert.strictEqual(text3.priceBasis, 'per_ton');

const text4 = parsePriceLine('арматура 12 12м 320 грн');
assert.ok(text4, 'Должно распознать арматуру');
assert.strictEqual(text4.profile.type, 'rebar');
assert.strictEqual(text4.profile.dims.d, 12);
assert.strictEqual(text4.length, 12);
assert.strictEqual(text4.price, 320);

const text5 = parsePriceLine('уголок 50х50х4 6м 850 грн');
assert.ok(text5, 'Должно распознать уголок');
assert.strictEqual(text5.profile.type, 'angle');
assert.strictEqual(text5.profile.dims.a, 50);
assert.strictEqual(text5.profile.dims.s, 4);

// Многострочное сообщение
const multiText = `
Поставщик Альфа: труба 40х40х2 6м 580 грн
Поставщик Бета: труба 40х40х2 6м 560 грн
`;
const multiParsed = parsePriceMessage(multiText);
assert.strictEqual(multiParsed.length, 2, 'Многострочное сообщение должно разобрать обе позиции');
assert.strictEqual(multiParsed[0].supplier, 'Альфа');
assert.strictEqual(multiParsed[1].supplier, 'Бета');

console.log('✔ Тест парсера текстовых сообщений пройден');

// 3. Тест нормализации и сравнения (Труба 40х40х2: Накладная vs Текст)
const normInvoice = normalizeItem(item1);
const normText = normalizeItem(text1);

assert.ok(normInvoice, 'Позиция накладной должна успешно нормализоваться');
assert.ok(normText, 'Позиция из текста должна успешно нормализоваться');

// 45 125 грн/т = 45.125 грн/кг
assert.strictEqual(normInvoice.pricePerKg, 45.125);

// Текст: 567.64 грн за 6м. Теоретический вес 1м = ~2.3864 кг. Всего = 14.3184 кг. Цена за кг = 567.64 / 14.3184 ≈ 39.64 грн/кг
assert.ok(Math.abs(normText.pricePerKg - 39.64) < 0.1, 'Цена за кг текста должна быть около 39.64 грн/кг');

// Проверяем, что текстовое предложение дешевле накладной
assert.ok(normText.pricePerKg < normInvoice.pricePerKg, 'Предложение из текста должно быть выгоднее накладной');

console.log(`Сравнение Труба 40х40х2:`);
console.log(`  Накладная (${normInvoice.supplier}): ${normInvoice.pricePerKg.toFixed(2)} грн/кг (${normInvoice.pricePerMeter.toFixed(2)} грн/м)`);
console.log(`  Текст (${normText.supplier}): ${normText.pricePerKg.toFixed(2)} грн/кг (${normText.pricePerMeter.toFixed(2)} грн/м)`);

const diffPercent = ((normInvoice.pricePerKg - normText.pricePerKg) / normInvoice.pricePerKg) * 100;
console.log(`  Выгода: ${diffPercent.toFixed(1)}%`);

console.log('✔ Все тесты успешно пройдены!');
