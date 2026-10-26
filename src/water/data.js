const BASE = '/data/water/';

/** Loads the surface manifest and its float32 vertex buffer. */
export async function loadWaterData() {
  const [manifest, buffer] = await Promise.all([
    fetch(`${BASE}surface.json`).then((response) => {
      if (!response.ok) throw new Error(`surface.json: ${response.status}`);
      return response.json();
    }),
    fetch(`${BASE}surface.bin`).then((response) => {
      if (!response.ok) throw new Error(`surface.bin: ${response.status}`);
      return response.arrayBuffer();
    })
  ]);

  const view = (entry) => new Float32Array(buffer, entry.offset, entry.length);

  return {
    ...manifest,
    patches: manifest.patches.map((patch) => ({
      ...patch,
      T: view(patch.T),
      logP: view(patch.logP),
      logRho: view(patch.logRho)
    })),
    curtains: manifest.curtains.map((curtain) => ({
      ...curtain,
      T: view(curtain.T),
      logP: view(curtain.logP),
      logRhoLow: view(curtain.logRhoLow),
      logRhoHigh: view(curtain.logRhoHigh)
    }))
  };
}
