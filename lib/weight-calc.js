// Плотность стали, кг/м3
const STEEL_DENSITY = 7850;

/**
 * Профильная (квадратная/прямоугольная) труба.
 * a, b — стороны сечения в мм (для квадратной a=b), s — толщина стенки в мм.
 * Возвращает вес 1 метра трубы в кг.
 */
function pipeProfileWeightPerMeter(a, b, s) {
  const perimeterInnerAdjust = 2 * (a + b) - 4 * s;
  return (perimeterInnerAdjust * s * STEEL_DENSITY) / 1_000_000;
}

/**
 * Круглая труба. D — наружный диаметр мм, s — толщина стенки мм.
 */
function pipeRoundWeightPerMeter(D, s) {
  return (Math.PI * (D - s) * s * STEEL_DENSITY) / 1_000_000;
}

/**
 * Лист. Вес на 1 м2, thickness в мм.
 */
function sheetWeightPerSqm(thicknessMm) {
  return (thicknessMm * STEEL_DENSITY) / 1000;
}

/**
 * Арматура / круглый пруток сплошной. d — диаметр мм. Вес 1 метра в кг.
 */
function rebarWeightPerMeter(d) {
  return (Math.PI * (d / 2) ** 2 * STEEL_DENSITY) / 1_000_000;
}

/**
 * Уголок (равнополочный и неравнополочный). a, b — стороны мм, s — толщина мм.
 */
function angleWeightPerMeter(a, b, s) {
  let sideA = Number(a);
  let sideB = Number(b);
  let wall = Number(s);
  if (s == null) {
    wall = sideB;
    sideB = sideA;
  }
  if (!sideA || !sideB || !wall || wall <= 0) return null;
  return ((sideA + sideB - wall) * wall * STEEL_DENSITY) / 1_000_000;
}

/**
 * Универсальный расчёт: по типу профиля и размерам определяет вес погонного метра (кг/м)
 * или вес квадратного метра для листа (кг/м2).
 * profile: { type: 'pipe_profile'|'pipe_round'|'sheet'|'rebar'|'angle', dims: {...} }
 */
function weightByProfile(profile) {
  if (!profile || !profile.type || !profile.dims) return null;
  const { type, dims } = profile;
  switch (type) {
    case 'pipe_profile':
      return pipeProfileWeightPerMeter(dims.a, dims.b ?? dims.a, dims.s);
    case 'pipe_round':
      return pipeRoundWeightPerMeter(dims.D, dims.s);
    case 'sheet':
      return sheetWeightPerSqm(dims.thickness);
    case 'rebar':
      return rebarWeightPerMeter(dims.d);
    case 'angle':
      return angleWeightPerMeter(dims.a, dims.b ?? dims.a, dims.s);
    default:
      return null;
  }
}

/**
 * Генерирует уникальный канонический ключ позиции для группировки предложений разных поставщиков.
 * Например, труба 20х40х2 и 40х20х2 получают одинаковый ключ 'pipe_profile:40x20x2'.
 */
function getProfileKey(profile) {
  if (!profile || !profile.type || !profile.dims) return 'unknown';
  const { type, dims } = profile;
  switch (type) {
    case 'pipe_profile': {
      const a = Number(dims.a);
      const b = Number(dims.b ?? dims.a);
      const max = Math.max(a, b);
      const min = Math.min(a, b);
      return `pipe_profile:${max}x${min}x${dims.s}`;
    }
    case 'pipe_round':
      return `pipe_round:${dims.D}x${dims.s}`;
    case 'sheet':
      return `sheet:${dims.thickness}`;
    case 'rebar':
      return `rebar:${dims.d}`;
    case 'angle': {
      const a = Number(dims.a);
      const b = Number(dims.b ?? dims.a);
      const max = Math.max(a, b);
      const min = Math.min(a, b);
      return `angle:${max}x${min}x${dims.s}`;
    }
    default:
      return 'other';
  }
}

/**
 * Читаемое название профиля для вывода в Telegram и Excel.
 */
function formatProfileTitle(profile) {
  if (!profile || !profile.type || !profile.dims) return 'Металлопрокат';
  const { type, dims } = profile;
  switch (type) {
    case 'pipe_profile': {
      const a = Number(dims.a);
      const b = Number(dims.b ?? dims.a);
      const max = Math.max(a, b);
      const min = Math.min(a, b);
      return `Труба проф. ${max}х${min}х${dims.s}`;
    }
    case 'pipe_round':
      return `Труба кругл. ${dims.D}х${dims.s}`;
    case 'sheet':
      return `Лист ${dims.thickness} мм`;
    case 'rebar':
      return `Арматура ф${dims.d} мм`;
    case 'angle': {
      const a = Number(dims.a);
      const b = Number(dims.b ?? dims.a);
      const max = Math.max(a, b);
      const min = Math.min(a, b);
      return `Уголок ${max}х${min}х${dims.s}`;
    }
    default:
      return 'Металлопрокат';
  }
}

module.exports = {
  STEEL_DENSITY,
  pipeProfileWeightPerMeter,
  pipeRoundWeightPerMeter,
  sheetWeightPerSqm,
  rebarWeightPerMeter,
  angleWeightPerMeter,
  weightByProfile,
  getProfileKey,
  formatProfileTitle,
};
