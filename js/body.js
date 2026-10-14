export const ACTIVITY_LEVELS = [
  ['sedentary', 'Mostly sitting', 1.2],
  ['light', 'Light — walking to class', 1.375],
  ['moderate', 'Moderate — sport 3-5×/week', 1.55],
  ['active', 'Very active — daily training', 1.725],
];

export const GOALS = [
  ['lose-fast', 'Lose 0.5 kg a week', -550],
  ['lose', 'Lose 0.25 kg a week', -275],
  ['maintain', 'Maintain weight', 0],
  ['gain', 'Gain 0.25 kg a week', 275],
  ['gain-fast', 'Gain 0.5 kg a week', 550],
];

export const KCAL_PER_KG = 7700;
const WALK_KCAL_PER_KG_KM = 0.5;
const FLOOR_HEIGHT_M = 3;
const CLIMB_EFFICIENCY = 0.25;

export const WORKOUTS = [
  ['walking', 'Walking', [3.0, 4.3, 5.0], true],
  ['running', 'Running', [8.3, 9.8, 11.0], true],
  ['cycling', 'Cycling', [4.0, 6.8, 10.0], false],
  ['gym', 'Gym / weights', [3.5, 5.0, 6.0], false],
  ['bodyweight', 'Push-ups, squats', [2.8, 3.8, 8.0], false],
  ['hiit', 'HIIT / circuit', [6.0, 8.0, 9.0], false],
  ['yoga', 'Yoga', [2.5, 3.0, 4.0], false],
  ['skipping', 'Skipping rope', [8.8, 11.8, 12.3], false],
  ['stairs', 'Stair climbing', [4.0, 6.0, 8.8], true],
  ['hiking', 'Hiking', [5.3, 6.0, 7.8], true],
  ['badminton', 'Badminton', [4.5, 5.5, 7.0], false],
  ['cricket', 'Cricket', [4.0, 4.8, 6.0], false],
  ['football', 'Football', [5.0, 7.0, 10.0], false],
  ['basketball', 'Basketball', [4.5, 6.5, 8.0], false],
  ['volleyball', 'Volleyball', [3.0, 4.0, 6.0], false],
  ['tabletennis', 'Table tennis', [3.0, 4.0, 5.0], false],
  ['tennis', 'Tennis', [5.0, 7.3, 8.0], false],
  ['swimming', 'Swimming', [5.8, 8.3, 9.8], false],
  ['dancing', 'Dancing', [3.0, 5.0, 7.3], false],
];
export const WORKOUT = Object.fromEntries(WORKOUTS.map(([id, label, mets, onFoot]) => [id, { id, label, mets, onFoot }]));
export const INTENSITY = ['light', 'moderate', 'vigorous'];

export const ready = (p) => Boolean(p && p.age && p.heightCm && p.weightKg);

export function stepLengthM(profile) {
  if (profile?.stepCm > 30 && profile.stepCm < 120) return profile.stepCm / 100;
  if (!profile?.heightCm) return 0.72;
  return (profile.heightCm * (profile.sex === 'female' ? 0.413 : 0.415)) / 100;
}

export function bmr(p) {
  if (!ready(p)) return null;
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'female' ? -161 : 5);
}

export function bmi(p) {
  if (!p?.heightCm || !p?.weightKg) return null;
  const m = p.heightCm / 100;
  const value = p.weightKg / (m * m);
  const category = value < 18.5 ? 'Underweight' : value < 23 ? 'Healthy' : value < 25 ? 'Overweight' : 'Obese';
  return { value, category, healthy: [18.5 * m * m, 22.9 * m * m] };
}

export function needs(p, measured = null) {
  const base = bmr(p);
  if (base == null) return null;
  const level = ACTIVITY_LEVELS.find(([id]) => id === (p.activity || 'light')) || ACTIVITY_LEVELS[1];
  const maintenance = base * level[2];
  const floor = p.sex === 'female' ? 1200 : 1500;
  const goals = GOALS.map(([id, label, shift]) => {
    const mid = Math.max(floor, maintenance + shift);
    return { id, label, kcal: Math.round(mid / 10) * 10, low: Math.round((mid * 0.95) / 10) * 10, high: Math.round((mid * 1.05) / 10) * 10, belowFloor: maintenance + shift < floor };
  });
  const goalId = p.goal === 'lose' ? 'lose' : p.goal === 'gain' ? 'gain' : p.goal || 'maintain';
  return {
    bmr: Math.round(base),
    maintenance: Math.round(maintenance),
    levels: ACTIVITY_LEVELS.map(([id, label, factor]) => ({ id, label, factor, kcal: Math.round(base * factor), current: id === level[0] })),
    goals,
    goal: goals.find((g) => g.id === goalId) || goals[2],
    measured: measured ? Math.round(measured) : null,
    floor,
    protein: { rda: Math.round(0.83 * p.weightKg), low: Math.round(1.2 * p.weightKg), high: Math.round(1.6 * p.weightKg) },
    waterL: Math.round(p.weightKg * 0.035 * 10) / 10,
    bmi: bmi(p),
  };
}

export const distanceKm = (steps, profile) => (steps * stepLengthM(profile)) / 1000;
export const walkKcal = (km, profile) => (profile?.weightKg ? WALK_KCAL_PER_KG_KM * profile.weightKg * km : 0);
export const floorKcal = (floors, profile) => (profile?.weightKg ? (floors * profile.weightKg * 9.81 * FLOOR_HEIGHT_M) / (CLIMB_EFFICIENCY * 4184) : 0);

export function workoutKcal({ type, intensity = 'moderate', minutes, overlapSteps = 0 }, profile) {
  const w = WORKOUT[type];
  if (!w || !profile?.weightKg || !minutes) return { gross: 0, net: 0, met: 0, stepCredit: 0 };
  const met = w.mets[Math.max(0, INTENSITY.indexOf(intensity))];
  const hours = minutes / 60;
  const gross = met * profile.weightKg * hours;
  const stepCredit = w.onFoot ? walkKcal(distanceKm(overlapSteps, profile), profile) : 0;
  const net = Math.max(0, (met - 1) * profile.weightKg * hours - stepCredit);
  return { gross: Math.round(gross), net: Math.round(net), met, stepCredit: Math.round(stepCredit) };
}

export function burn({ profile, steps = 0, floors = 0, workouts = [], intake = 0, fraction = 1 }) {
  const resting = (bmr(profile) || 0) * fraction;
  const km = distanceKm(steps, profile);
  const walking = walkKcal(km, profile);
  const stairs = floorKcal(floors, profile);
  const exercise = workouts.reduce((a, w) => a + (w.kcal || 0), 0);
  const digestion = intake * 0.1;
  const total = resting + digestion + walking + stairs + exercise;
  return {
    resting: Math.round(resting), digestion: Math.round(digestion), walking: Math.round(walking), stairs: Math.round(stairs),
    exercise: Math.round(exercise), active: Math.round(walking + stairs + exercise), total: Math.round(total), km,
    known: ready(profile),
  };
}

export function dayFraction(dateK, now = new Date()) {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (dateK < key) return 1;
  if (dateK > key) return 0;
  return (now.getHours() * 60 + now.getMinutes()) / 1440;
}

export function trend(weights, days = 30, now = new Date()) {
  if (weights.length < 2) return null;
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const pts = weights.map((w) => ({ t: new Date(w.date).getTime(), kg: w.kg })).filter((p) => p.t >= cutoff.getTime());
  if (pts.length < 2) return null;
  const n = pts.length;
  const mt = pts.reduce((a, p) => a + p.t, 0) / n;
  const mk = pts.reduce((a, p) => a + p.kg, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.t - mt) * (p.kg - mk);
    den += (p.t - mt) ** 2;
  }
  const perMs = den ? num / den : 0;
  return { perWeek: perMs * 7 * 864e5, first: pts[0], last: pts[n - 1], points: n };
}
