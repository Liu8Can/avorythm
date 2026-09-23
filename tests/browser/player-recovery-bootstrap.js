// Test-only Chrome adapter. Playback, MediaSource, Web Audio and BroadcastChannel
// remain native; no production API credentials or network providers are involved.
if (location.pathname.endsWith('/tests/browser/player-recovery-producer.html')) {
  const producer = new BroadcastChannel('avorythm-sync');
  const duration = Math.max(30, Number(new URLSearchParams(location.search).get('duration')) || 30);
  const fixture = (async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(15);
    const mimeType = ['video/webm;codecs=vp8', 'video/webm']
      .find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('media_recorder_unavailable');
    const chunks = [];
    const recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 180000});
    recorder.ondataavailable = ({data}) => { if (data.size) chunks.push(data); };
    let frame = 0;
    const paint = setInterval(() => {
      frame += 1;
      context.fillStyle = `hsl(${frame % 360} 70% 35%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = 'white'; context.font = '28px sans-serif';
      context.fillText(String(frame), 20, 42);
    }, 66);
    recorder.start(250);
    await new Promise((resolve) => setTimeout(resolve, duration * 1000));
    const stopped = new Promise((resolve) => recorder.addEventListener('stop', resolve, {once: true}));
    recorder.stop(); await stopped;
    clearInterval(paint); stream.getTracks().forEach((track) => track.stop());
    return {chunks, mimeType};
  })();
  const send = (message) => producer.postMessage(message);
  let replays = 0;
  let blockReplay = false;
  const samples = new Int16Array(24000 * 1.5);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * Math.PI * 2 * 440 / 24000) * 1500;
  async function replay(position, replayId) {
    if (blockReplay) return;
    const recorded = await fixture;
    replays++;
    send({type: 'session-reset', position, duration, replayId});
    send({type: 'media-init', mimeType: recorded.mimeType, bufferSeconds: 8});
    for (const chunk of recorded.chunks) send({type: 'media-chunk', data: chunk});
    for (let start = 0; start < duration; start += 2) {
      send({type: 'dub-chunk', id: `speech-${start}`, start, data: samples.buffer});
      for (const translated of [false, true]) send({
        type: 'caption', id: `cue-${start}`, translated, start, end: start + 1.5,
        text: `${translated ? 'ترجمه' : 'Source'} ${start}`
      });
    }
    send({type: 'processing-frontier', seconds: duration});
    send({type: 'media-progress', duration});
  }
  producer.onmessage = ({data}) => { if (data?.type === 'ready') void replay(data.position || 0, data.replayId); };
  globalThis.producerTest = {
    fixture, get replays() { return replays; },
    blockReplay(value) { blockReplay = value; },
    warning(error = 'groq_timeout') { send({type: 'warning', error}); }
  };
}

if (location.pathname.endsWith('/extension/player.html')) {
  const settings = {
    locale: 'en', playbackMode: 'synchronized', syncBufferSeconds: 8,
    syncCaptionEngine: new URLSearchParams(location.search).get('engine') || 'gemini',
    synchronizedOutput: {
      originalAudioEnabled: false, dubAudioEnabled: true,
      sourceSubtitlesEnabled: true, translatedSubtitlesEnabled: true,
      originalVolume: 1, dubVolume: 1, autoDuck: true
    }
  };
  const sessionKey = 'avorythm-player-test-session';
  const sourceBuffers = [];
  const audioSources = [];
  let replays = 0;
  const observer = new BroadcastChannel('avorythm-sync');
  observer.onmessage = ({data}) => { if (data.type === 'session-reset') replays++; };
  const originalAddBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (...args) {
    const buffer = originalAddBuffer.apply(this, args);
    sourceBuffers.push(buffer);
    return buffer;
  };
  const originalCreateSource = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function (...args) {
    const source = originalCreateSource.apply(this, args);
    audioSources.push(source);
    return source;
  };
  globalThis.chrome = {
    storage: {
      local: {async get() { return {settings}; }, async set() {}},
      session: {
        async get() { return JSON.parse(localStorage.getItem(sessionKey) || '{}'); },
        async set(value) { localStorage.setItem(sessionKey, JSON.stringify(value)); }
      }
    },
    runtime: {
      async sendMessage() { return {ok: true, state: {active: true, sourceTitle: 'Playback recovery regression'}}; },
      async openOptionsPage() {}
    }
  };
  globalThis.playerTest = {
    get replays() { return replays; }, audioSources,
    // Ask the actual decoder to reject malformed bytes, then recover via the bridge.
    async corrupt() {
      // Let the native player finish appending the snapshot before injecting a
      // decoder fault (an append-during-update exception is a different case).
      const deadline = performance.now() + 10000;
      while (performance.now() < deadline) {
        const buffer = sourceBuffers.at(-1);
        if (buffer && !buffer.updating) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (buffer === sourceBuffers.at(-1) && !buffer.updating) {
            buffer.appendBuffer(new Uint8Array([0xff, 0, 1, 2, 3]));
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('fixture_append_did_not_settle');
    }
  };
}
