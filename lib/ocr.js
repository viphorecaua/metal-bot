// Бесплатный OCR через ocr.space. Ключ берётся на https://ocr.space/ocrapi (без карты).
async function recognizeImageText(imageUrl, fileType = 'JPG') {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) throw new Error('OCR_SPACE_API_KEY не задан в переменных окружения');

  // Нормализуем расширение (JPG, PNG, PDF)
  let normType = String(fileType || 'JPG').toUpperCase();
  if (normType === 'JPEG') normType = 'JPG';

  const params = new URLSearchParams({
    apikey: apiKey,
    url: imageUrl,
    language: 'auto',
    OCREngine: '2',
    isTable: 'true',
    scale: 'true',
    filetype: normType,
  });

  const res = await fetch('https://api.ocr.space/parse/imageurl?' + params.toString());
  const data = await res.json();

  if (data.IsErroredOnProcessing) {
    const err = data.ErrorMessage ? JSON.stringify(data.ErrorMessage) : (data.ErrorDetails || 'Ошибка обработки');
    throw new Error('OCR error: ' + err);
  }

  return (data.ParsedResults || []).map((r) => r.ParsedText).join('\n');
}

module.exports = { recognizeImageText };

