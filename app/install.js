const installBanner = document.getElementById('install-banner');
const installDetails = document.getElementById('install-details');
let installPrompt;

if (navigator.standalone) installBanner.hidden = true;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});

installDetails.querySelector('summary').addEventListener('click', async event => {
  if (!installPrompt) return;
  event.preventDefault();
  const prompt = installPrompt;
  installPrompt = undefined;
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') installBanner.hidden = true;
  } catch {
    installDetails.open = true;
  }
});

window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  installBanner.hidden = true;
});
