import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

export async function readFeed(directory) {
  try {
    const value = JSON.parse(await readFile(path.join(directory, 'feed.json'), 'utf8'));
    if (Array.isArray(value.items)) return value;
  } catch (error) { if (error.code !== 'ENOENT') console.error('feed_read_failed'); }
  return {updated: null, items: []};
}

export async function saveFeed(directory, value) {
  await mkdir(directory, {recursive: true, mode: 0o700});
  const destination = path.join(directory, 'feed.json');
  await writeFile(destination + '.tmp', JSON.stringify(value), {mode: 0o600});
  await rename(destination + '.tmp', destination);
}
