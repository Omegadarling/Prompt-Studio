// Shared by the browser and server: slot numbers follow order within each type.
export const MAX_ASSETS = 24;
export const MAX_ASSET_DESCRIPTION_LENGTH = 6000;
export const MAX_REFERENCE_NOTES_LENGTH = 12000;
const TITLES = Object.freeze({ picture: 'Picture', audio: 'Audio', video: 'Video' });

/** Number drafts without requiring their descriptions to be complete. */
export function numberAssets(assets) {
  const counts = { picture: 0, audio: 0, video: 0 };
  return assets.map((asset) => {
    if (!Object.hasOwn(TITLES, asset.type)) throw new Error('Choose Picture, Audio, or Video for each asset.');
    const number = ++counts[asset.type];
    return { ...asset, number, label: `${TITLES[asset.type]} ${number}` };
  });
}

export function serializeAssets(assets) {
  return numberAssets(assets).map(({ label, description }) => `${label} — ${description.trim()}`).join('\n\n');
}

/** Validate actual submitted assets; drop UI metadata and never infer media contents. */
export function normalizeAssets(raw) {
  if (!Array.isArray(raw)) throw new Error('Reference assets must be a list.');
  if (raw.length > MAX_ASSETS) throw new Error(`Use no more than ${MAX_ASSETS} reference assets.`);
  const ids = new Set();
  const assets = raw.map((asset, index) => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset) || !Object.hasOwn(TITLES, asset.type)) {
      throw new Error(`Choose Picture, Audio, or Video for asset ${index + 1}.`);
    }
    const id = asset.id ?? `asset-${index + 1}`;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ids.has(id)) {
      throw new Error('Each reference asset needs its own unique identifier. Remove and re-add the affected card.');
    }
    ids.add(id);
    if (typeof asset.description !== 'string' || !asset.description.trim()) throw new Error(`Describe asset ${index + 1} and what it should control.`);
    if (asset.description.length > MAX_ASSET_DESCRIPTION_LENGTH || asset.description.includes('\0')) throw new Error(`Keep each asset description under ${MAX_ASSET_DESCRIPTION_LENGTH.toLocaleString('en-US')} characters without null characters.`);
    return { id, type: asset.type, description: asset.description.replace(/\r\n?/g, '\n').trim() };
  });
  if (serializeAssets(assets).length > MAX_REFERENCE_NOTES_LENGTH) throw new Error(`Keep the combined asset descriptions and labels under ${MAX_REFERENCE_NOTES_LENGTH.toLocaleString('en-US')} characters.`);
  return assets;
}
