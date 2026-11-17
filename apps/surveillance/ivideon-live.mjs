export function playIvideon(video, url, notify) {
  const Media = window.MediaSource || window.ManagedMediaSource;
  if (!Media) throw Error('Этот браузер не поддерживает встроенный эфир Ivideon.');
  const media = new Media();
  const address = URL.createObjectURL(media);
  const endpoint = new URL(url);
  if (endpoint.pathname.endsWith('/functions/v1/edpvz-ivideon-check')) endpoint.searchParams.set('frames', 'text');
  const socket = new WebSocket(endpoint);
  socket.binaryType = 'arraybuffer';
  video.disableRemotePlayback = true;
  video.src = address;
  let buffer, stopped = false, playing = false, initializing = false, seenCodec;
  const queue = [];
  let fragments = 0;
  let queuedBytes = 0;
  const startup = setTimeout(() => finish(
    seenCodec === 'audio' ? 'Ivideon передал аудиодорожку, но видеодорожка не появилась.' :
    seenCodec === 'video' && fragments ? 'Получено видеофрагментов: ' + fragments + ', но браузер не начал воспроизведение.' :
    seenCodec === 'video' ? 'Ivideon описал видеодорожку, но не прислал видеофрагменты.' :
    'Ivideon не передал совместимую видеодорожку.'
  ), 12000);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(startup);
    socket.close();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(address);
  };
  const finish = (message) => {
    if (stopped) return;
    stop();
    notify(message, {started:playing});
  };
  function pump() {
    if (stopped || !buffer || buffer.updating) return;
    try {
      if (buffer.buffered.length) {
        const first = buffer.buffered.start(0);
        const last = buffer.buffered.end(buffer.buffered.length - 1);
        if (last - first > 45) {
          if (last - video.currentTime > 12) video.currentTime = last - 2;
          buffer.remove(first, last - 25);
          return;
        }
        if (!playing) {
          playing = true;
          clearTimeout(startup);
          if (video.currentTime < first) video.currentTime = first;
          video.play().catch(() => {});
          notify('', {started:true});
        }
      }
      const chunk = queue.shift();
      if (chunk) {
        queuedBytes -= chunk.byteLength;
        buffer.appendBuffer(chunk);
      }
    } catch {
      finish('Браузер не смог воспроизвести поток Ivideon.');
    }
  }
  function enqueue(chunk) {
    queuedBytes += chunk.byteLength;
    if (queuedBytes > 16 * 1024 * 1024) {
      finish('Камера передаёт видео быстрее, чем браузер успевает его обработать.');
      return;
    }
    queue.push(chunk);
    pump();
  }
  socket.onmessage = ({data}) => {
    if (stopped) return;
    if (typeof data === 'string' && data.startsWith('edpvz-fmp4:')) {
      try { data = Uint8Array.from(atob(data.slice('edpvz-fmp4:'.length)), (c) => c.charCodeAt(0)); }
      catch { finish('Не удалось прочитать видеофрагмент ретранслятора.'); return; }
    }
    if (typeof data !== 'string') {
      if (seenCodec !== 'audio' || initializing) {
        fragments++;
        enqueue(data);
      }
      return;
    }
    try {
      const message = JSON.parse(data);
      if (message.type === 'fragment' && typeof message.data === 'string' && message.data) {
        if (seenCodec !== 'audio' || initializing) {
          fragments++;
          enqueue(Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0)));
        }
        return;
      }
      if (message.type === 'error' || message.type === 'stream-error') {
        const code = typeof message.code === 'number' && Number.isInteger(message.code) ? ' (код ' + message.code + ')' : '';
        finish('Видеосервер Ivideon сообщил об ошибке потока' + code + '.');
        return;
      }
      if (message.type !== 'stream-init' || initializing) return;
      const description = typeof message.codec_string === 'string' ? message.codec_string.trim() : '';
      if (/^(?:mp4a|opus|aac|ac-3|ec-3|alaw|ulaw|pcm)/i.test(description)) {
        seenCodec ??= 'audio';
        queue.length = 0;
        queuedBytes = 0;
        return;
      }
      const init = typeof message.data === 'string' && message.data
        ? Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0)) : null;
      let codec = description.match(/\b(?:avc[13]\.[a-f0-9]{6}|(?:hvc1|hev1)\.[a-z0-9.]+)(?![a-z0-9.])/i)?.[0];
      if (!codec && init) {
        // avcC contains the AVC profile, compatibility and level bytes.
        for (let i = 4; i + 7 < init.length; i++) {
          if (init[i] !== 97 || init[i+1] !== 118 || init[i+2] !== 99 || init[i+3] !== 67 || init[i+4] !== 1) continue;
          codec = 'avc1.' + Array.from(init.slice(i+5, i+8), (byte) => byte.toString(16).padStart(2,'0')).join('');
          break;
        }
      }
      if (!codec) return;
      const mime = 'video/mp4; codecs="' + codec + '"';
      if (!Media.isTypeSupported(mime)) {
        finish('Браузер не поддерживает видеокодек камеры (' + codec.split('.')[0] + ').');
        return;
      }
      initializing = true;
      seenCodec = 'video';
      const prepare = () => {
        if (stopped || buffer) return;
        try {
          buffer = media.addSourceBuffer(mime);
          buffer.addEventListener('updateend', pump);
          buffer.addEventListener('error', () => finish('Ошибка декодирования эфира Ivideon.'));
          if (init) {
            queue.unshift(init);
            queuedBytes += init.byteLength;
          }
          pump();
        } catch {
          finish('Браузер не поддерживает формат эфира этой камеры.');
        }
      };
      if (media.readyState === 'open') prepare();
      else media.addEventListener('sourceopen', prepare, {once:true});
    } catch {
      finish('Не удалось разобрать ответ видеосервера Ivideon.');
    }
  };
  socket.onerror = () => finish('Видеосервер Ivideon не принял соединение.');
  socket.onclose = () => finish('Соединение с камерой Ivideon закрыто.');
  return stop;
}

export function playIvideonHls(video, url, notify) {
  const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const supportsNative = Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
  const playerModes = appleMobile && supportsNative ? ['native','mse'] :
    supportsNative ? ['mse','native'] : ['mse'];
  let player, mode, timer, started = false, stopped = false, attempt = 0;
  let manual = false;

  function clearSource() {
    player?.destroy();
    player = undefined;
    video.removeAttribute('src');
    video.load();
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    attempt++;
    clearTimeout(timer);
    video.removeEventListener('playing', onPlaying);
    video.removeEventListener('error', onError);
    clearSource();
  }
  function onPlaying() {
    if (started || stopped) return;
    started = true;
    clearTimeout(timer);
    notify('', {started:true});
  }
  function onError() {
    if (mode === 'native') next('Браузер не смог открыть поток Ivideon.');
  }
  function next(message) {
    if (stopped) return;
    if (!started && playerModes.length) {
      startMode();
      return;
    }
    stop();
    notify(message, {started});
  }
  function play(currentAttempt) {
    video.play().catch(error => {
      if (stopped || attempt !== currentAttempt || error.name !== 'NotAllowedError') return;
      manual = true;
      clearTimeout(timer);
      notify('Нажми ▶ на видео, чтобы запустить воспроизведение.', {started:true});
    });
  }
  function startMode() {
    const currentAttempt = ++attempt;
    mode = undefined;
    clearTimeout(timer);
    clearSource();
    manual = false;
    mode = playerModes.shift();
    timer = setTimeout(() => {
      if (!manual && attempt === currentAttempt) next('Ivideon HLS: видео не загрузилось.');
    },appleMobile ? 30000 : 16000);
    if (mode === 'native') {
      const endpoint = new URL(url);
      const relay = endpoint.pathname.endsWith('/functions/v1/edpvz-ivideon-check');
      if (relay) video.crossOrigin = 'anonymous';
      else video.removeAttribute('crossorigin');
      video.src = url;
      play(currentAttempt);
      return;
    }
    import('https://cdn.jsdelivr.net/npm/hls.js@1.6.15/dist/hls.mjs').then(({default:Hls}) => {
      if (stopped || attempt !== currentAttempt) return;
      if (!Hls.isSupported()) return next('В этом браузере просмотр HLS недоступен.');
      player = new Hls({enableWorker:false, maxBufferLength:20, backBufferLength:20});
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && attempt === currentAttempt) {
          next('Ivideon HLS: ' + (data.details?.replace(/[^a-zA-Z]/g,'') || 'ошибка потока') + '.');
        }
      });
      player.on(Hls.Events.MANIFEST_PARSED, () => play(currentAttempt));
      player.loadSource(url);
      player.attachMedia(video);
    }).catch(() => {
      if (!stopped && attempt === currentAttempt) next('Не удалось загрузить плеер HLS.');
    });
  }
  video.addEventListener('playing',onPlaying);
  video.addEventListener('error',onError);
  video.disableRemotePlayback = true;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  startMode();
  return stop;
}
