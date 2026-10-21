// Service worker mínimo: solo existe para que Chrome considere la app
// "instalable" (PWA). No cachea nada — streaming en vivo no tiene sentido
// offline, así que no se gana nada complicándolo.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("fetch", () => {
  // sin intercept: todo va directo a la red
});
