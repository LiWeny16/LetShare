import { chromium } from "playwright";
import { ensureLoudWav } from "../../../../tests/e2e/loudwav.mts";

const browser = await chromium.launch({
  headless: false,
  args: [
    `--use-file-for-fake-audio-capture=${ensureLoudWav()}`,
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
try {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const page = await context.newPage();
  await page.goto("https://letshare.fun", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const context = new AudioContext();
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const measures = [];
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      analyser.getFloatTimeDomainData(samples);
      measures.push(Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length));
    }
    return { measures, context: context.state, track: stream.getAudioTracks().map((track) => ({ readyState: track.readyState, enabled: track.enabled, muted: track.muted, settings: track.getSettings() })) };
  });
  console.log(JSON.stringify(result));
  await context.close();
} finally {
  await browser.close();
}
