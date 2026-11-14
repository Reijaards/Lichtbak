// Lichtbak — lokale opslag (IndexedDB). Foto's verlaten het apparaat nooit.
const DB = 'lichtbak', VER = 1;
let dbp = null;
function open(){
  return dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('photos', {keyPath:'id'});
      d.createObjectStore('originals');
      d.createObjectStore('previews');
      d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
function run(stores, mode, fn){
  return open().then(d => new Promise((res, rej) => {
    const t = d.transaction(stores, mode); let out;
    const r = fn(t);
    if(r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}
export const store = {
  allPhotos: () => run('photos', 'readonly', t => t.objectStore('photos').getAll()),
  getPhoto: id => run('photos', 'readonly', t => t.objectStore('photos').get(id)),
  putPhoto: p => run('photos', 'readwrite', t => t.objectStore('photos').put(p)),
  getOriginal: id => run('originals', 'readonly', t => t.objectStore('originals').get(id)),
  getPreview: id => run('previews', 'readonly', t => t.objectStore('previews').get(id)),
  addPhoto: (p, orig, prev) => run(['photos','originals','previews'], 'readwrite', t => {
    t.objectStore('photos').put(p); t.objectStore('originals').put(orig, p.id); t.objectStore('previews').put(prev, p.id);
  }),
  deletePhoto: id => run(['photos','originals','previews'], 'readwrite', t => {
    t.objectStore('photos').delete(id); t.objectStore('originals').delete(id); t.objectStore('previews').delete(id);
  }),
  getMeta: k => run('meta', 'readonly', t => t.objectStore('meta').get(k)),
  setMeta: (k, v) => run('meta', 'readwrite', t => t.objectStore('meta').put(v, k)),
};
