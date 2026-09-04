/**
 * Phase 0 spike / smoke test (design doc §5, §9).
 *
 * GO/NO-GO acceptance for the Skia unified-renderer migration. If this screen
 * builds and shows BOTH:
 *   1. a live Skia <Canvas> overlay drawn via the shared `draw*`, and
 *   2. an offscreen-rendered PNG (Surface.MakeOffscreen → encodeToBytes → file)
 * then `@shopify/react-native-skia` links against the project's static-frameworks
 * + ffmpeg-fork Pod setup and the headless export path is viable → proceed to
 * Phases 2–4. Reach it via `router.push("/(app)/skia-smoke")` in a dev build.
 */
import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, ScrollView, StyleSheet } from "react-native";
import { Canvas, Picture, Skia, createPicture } from "@shopify/react-native-skia";
import { DEFAULT_STOPWATCH_CONFIG, type SplitTime } from "@swimhub-timer/shared";
import { drawStopwatch, drawPassedSplit } from "@swimhub-timer/shared";
import { loadOverlayTypefaces, type OverlayTypefaces } from "../../lib/overlay/fonts";
import { SkiaOverlayContext } from "../../lib/overlay/skia-context";
import { renderFinishSummaryPng } from "../../lib/overlay/render-offscreen";

const SAMPLE_SPLITS: SplitTime[] = [
  { distance: 25, time: 14.83, lapTime: 14.83, memo: "" },
  { distance: 50, time: 30.42, lapTime: 15.59, memo: "ドルフィン5回" },
  { distance: 75, time: 46.7, lapTime: 16.28, memo: "" },
  { distance: 100, time: 63.21, lapTime: 16.51, memo: "" },
];

const W = 1280;
const H = 720;

export default function SkiaSmokeScreen() {
  const [typefaces, setTypefaces] = useState<OverlayTypefaces | null>(null);
  const [pngUri, setPngUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tf = await loadOverlayTypefaces();
        if (alive) setTypefaces(tf);
        const uri = await renderFinishSummaryPng(
          DEFAULT_STOPWATCH_CONFIG,
          SAMPLE_SPLITS,
          63.21,
          100,
          W,
          H,
        );
        if (alive) setPngUri(uri);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const picture = useMemo(() => {
    if (!typefaces) return null;
    return createPicture(
      (canvas) => {
        const ctx = new SkiaOverlayContext(canvas, typefaces);
        drawStopwatch(ctx, { width: W, height: H }, DEFAULT_STOPWATCH_CONFIG, 30.42);
        const passedSplit = SAMPLE_SPLITS[1];
        if (passedSplit) {
          drawPassedSplit(ctx, { width: W, height: H }, DEFAULT_STOPWATCH_CONFIG, 30.42, passedSplit);
        }
      },
      Skia.XYWHRect(0, 0, W, H),
    );
  }, [typefaces]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h}>Skia smoke test (Phase 0)</Text>

      <Text style={styles.label}>1. Live Skia &lt;Canvas&gt; (shared draw*)</Text>
      <View style={[styles.frame, { aspectRatio: W / H }]}>
        {picture ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={picture} />
          </Canvas>
        ) : (
          <Text style={styles.muted}>Loading typefaces…</Text>
        )}
      </View>

      <Text style={styles.label}>2. Offscreen PNG (Surface → encodeToBytes → file)</Text>
      <View style={[styles.frame, { aspectRatio: W / H }]}>
        {pngUri ? (
          <Image source={{ uri: pngUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <Text style={styles.muted}>Rendering…</Text>
        )}
      </View>

      {error && <Text style={styles.error}>NO-GO: {error}</Text>}
      {pngUri && !error && <Text style={styles.ok}>GO ✓ offscreen PNG: {pngUri}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  h: { fontSize: 18, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "600", marginTop: 8 },
  frame: { width: "100%", backgroundColor: "#1e3a5f", borderRadius: 8, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  muted: { color: "rgba(255,255,255,0.6)" },
  ok: { color: "#16a34a", fontSize: 12 },
  error: { color: "#dc2626", fontSize: 12 },
});
