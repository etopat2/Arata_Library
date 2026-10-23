import { openDB } from 'idb';

const database = openDB('arata-foundation', 1, {
  upgrade(db) {
    db.createObjectStore('preferences');
  },
});
export async function getTheme(): Promise<'dark' | 'light'> {
  const value: unknown = await (await database).get('preferences', 'theme');
  return value === 'light' ? 'light' : 'dark';
}
export async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  await (await database).put('preferences', theme, 'theme');
}
