// Device-local preferences. Sync credentials live separately (github-sync.js).

export const SETTINGS_KEY = 'piq.settings.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  batchSize: 10,          // cards per batch; sessions run as many batches as you like
  newPerDay: null,        // null means no limit
  maxIntervalDays: 365,   // longest gap between reviews of a card
  cameraMode: 'over_shoulder',
  matureAids: 'fade',     // on mature cards: 'fade' the aids, keep the 'map', or keep 'all'
  chooseTimeScale: 1,     // stretches only the clock on timed cards (1, 1.25, 1.5 or 2); rating suggestions keep the design window
  requestRetention: 0.9,
  autoSync: true,
  deviceLabel: '',
});

export function loadSettings(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? '{}');
    if (saved.batchSize == null) delete saved.newPerDay; // saved before batches existed: drop the old daily cap
    delete saved.sessionMinutes;
    if (saved.alwaysMiniMap && !saved.matureAids) saved.matureAids = 'map'; // older setting
    delete saved.alwaysMiniMap;
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  storage?.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, updated_at: new Date().toISOString() }));
}
