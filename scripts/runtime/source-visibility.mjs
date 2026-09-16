import { getObscurationEligibility } from "./obscuration-runtime.mjs";

/**
 * Evaluate a target against the recorded cast token's own Foundry detection modes.
 * CanvasVisibility.testVisibility is deliberately not used: it combines every
 * active source and treats an unobserved GM canvas as visible.
 */
export function testTargetVisibleToSourceToken(sourceToken, targetToken) {
  const sourceObject = sourceToken?.object ?? null;
  const targetObject = targetToken?.object ?? null;
  if (!sourceObject || !targetObject) return { visible: false, reason: "token-placeable-unavailable" };
  if (!sourceObject.hasSight) return { visible: false, reason: "source-has-no-sight" };

  let temporarySource = null;
  let visionSource = sourceObject.vision?.active ? sourceObject.vision : null;
  if (!visionSource) {
    const Source = globalThis.foundry?.canvas?.sources?.PointVisionSource;
    const data = sourceObject._getVisionSourceData?.();
    if (!Source || !data) return { visible: false, reason: "source-vision-unavailable" };
    try {
      // A GM need not control the caster, so Foundry may not maintain its
      // vision source. Construct one without adding it to canvas sources.
      temporarySource = new Source({ object: sourceObject });
      temporarySource.initialize(data);
      visionSource = temporarySource;
    } catch (_error) {
      temporarySource?.destroy?.();
      return { visible: false, reason: "source-vision-initialization-failed" };
    }
  }

  try {
    const bounds = targetObject.bounds;
    const center = targetObject.center;
    if (!bounds || !center) return { visible: false, reason: "target-bounds-unavailable" };
    const elevation = targetToken.getMovementOrigin?.().elevation ?? targetToken.elevation ?? 0;
    const level = globalThis.canvas?.scene?.levels?.get?.(targetToken.level) ?? null;
    const offsets = [[0, 0], [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
    const tests = offsets.map(([dx, dy]) => ({
      point: { x: center.x + dx * bounds.width, y: center.y + dy * bounds.height, elevation },
      level,
      los: new Map()
    }));
    const config = { object: targetObject, level, tests };
    const modes = globalThis.CONFIG?.Canvas?.detectionModes ?? {};
    for (const [id, mode] of Object.entries(sourceToken.detectionModes ?? {})) {
      const detectionMode = modes[id];
      if (!detectionMode || !getObscurationEligibility(detectionMode).affected) continue;
      if (detectionMode.testVisibility(visionSource, mode, config) === true) {
        return { visible: true, reason: "source-visual-detection", detectionModeId: id };
      }
    }
    return { visible: false, reason: "source-cannot-see-target" };
  } catch (_error) {
    return { visible: false, reason: "source-visibility-test-failed" };
  } finally {
    temporarySource?.destroy?.();
  }
}
