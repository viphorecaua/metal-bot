// Бесплатный OCR через ocr.space. Ключ берётся на https://ocr.space/ocrapi (без карты).
async function recognizeImageText(imageUrl) {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) throw new Error('OCR_SPACE_API_KEY не задан');

  const params = new URLSearchParams({
    apikey: apiKey,
    url: imageUrl,
    language: 'ukr',
    OCREngine: '2',
    isTable: 'true',
    scale: 'true',
  });

  const res = await fetch('https://api.ocr.space/parse/imageurl?' + params.toString());
  const data = await res.json();

  if (data.IsErroredOnProcessing) {
    throw new Error('OCR error: ' + JSON.stringify(data.ErrorMessage));
  }

  return (data.ParsedResults || []).map((r) => r.ParsedText).join('\n');
}

module.exports = { recognizeImageText };
