export const registerServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    const register = () => {
      navigator.serviceWorker
        .register(`${process.env.PUBLIC_URL || ''}/service-worker.js`)
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error('Service worker registration failed:', error);
        });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
    }
  }
};

export const unregisterServiceWorker = () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        registration.unregister();
      })
      .catch(() => undefined);
  }
};
