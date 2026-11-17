export function playIvideon(video, url, notify) {
  const Media = window.ManagedMediaSource || window.MediaSource;
  if (!Media) throw Error('Этот браузер не поддерживает встроенный эфир Ivideon.');
  const media = new Media();
  const address = URL.createObjectURL(media);
  const socket = new WebSocket(url);
  socket.binaryType = 'arraybuffer';
  video.disableRemotePlayback = true;
  video.src = address;
  let buffer, stopped = false, playing = false;
  const queue = [];
  let queuedBytes = 0;
  const startup = setTimeout(() => finish('Камера не передала видео. Проверь её статус в Ivideon.'), 15000);
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
    notify(message);
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
          notify('');
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
    if (typeof data !== 'string') {
      enqueue(data);
      return;
    }
    try {
      const message = JSON.parse(data);
      if (message.type !== 'stream-init' || buffer) return;
      if (!/^avc1\.[a-f0-9]{6}$/i.test(message.codec_string) || typeof message.data !== 'string') {
        finish('Камера вернула неподдерживаемый формат видео. Выбери H.264 в Ivideon.');
        return;
      }
      const init = Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0));
      const prepare = () => {
        if (stopped || buffer) return;
        try {
          buffer = media.addSourceBuffer('video/mp4; codecs="' + message.codec_string + '"');
          buffer.addEventListener('updateend', pump);
          buffer.addEventListener('error', () => finish('Ошибка декодирования эфира Ivideon.'));
          queue.unshift(init);
          queuedBytes += init.byteLength;
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
